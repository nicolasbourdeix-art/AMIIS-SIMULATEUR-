/**
 * Domotique.gs — Consignes de chauffage et d'eau chaude (ECS) calculées à partir des réservations,
 * lues par Home Assistant (capteur REST) toutes les quelques minutes.
 *
 * Chauffage (par logement) :
 *   confort  → séjour en cours, ou préchauffage avant une arrivée
 *   menage   → quelques heures après un départ (température éco, le temps du ménage)
 *   eco      → logement vide mais prochaine arrivée proche (on ne laisse pas refroidir les murs)
 *   inoccupe → logement vide pour un moment (température basse)
 *   arret    → chauffage désactivé pour ce logement (été)
 *
 * Eau chaude (par « groupe eau chaude ») : un même ballon peut servir plusieurs logements
 * (à Tilh, la pompe à chaleur produit l'eau chaude des deux maisons). Le ballon est en marche
 * dès qu'AU MOINS UN logement du groupe en a besoin :
 *   relance → les heures avant une arrivée : montée à la température de relance (60 °C par défaut,
 *             ce qui assure aussi la sécurité sanitaire après une période d'arrêt), même en heures pleines
 *   marche  → pendant un séjour
 *   arret   → plus personne : température d'arrêt (ou mode arrêt du chauffe-eau)
 */

var DOMO_DEFAUT = {
  actif: 'oui',            // envoyer ce logement à Home Assistant
  type_chauffage: 'autre', // clé de PRESETS_CHAUFFAGE (sert aux valeurs conseillées)
  chauffage: 'oui',        // 'non' = mode « arret » (été)
  prechauffage_h: 4,       // heures de préchauffage avant l'arrivée
  temp_confort: 20,
  temp_eco: 17,
  temp_inoccupe: 12,
  seuil_inoccupe_h: 36,    // si la prochaine arrivée est à moins de X h, on reste en éco
  duree_menage_h: 3,       // heures en mode « ménage » après le départ
  groupe_ecs: '',          // même valeur = même ballon (ex. TILH). Vide = ballon propre au logement
  ecs_avance_h: 8,         // heures de relance du ballon avant l'arrivée
  ecs_temp_relance: 60,
  ecs_temp_marche: 52,
  ecs_temp_arret: 40
};

var CHAMPS_TEXTE_DOMO = ['actif', 'type_chauffage', 'chauffage', 'groupe_ecs'];

/** Valeurs conseillées selon le type de chauffage (appliquées depuis l'interface). */
var PRESETS_CHAUFFAGE = {
  // Forte inertie : on préchauffe longtemps, on ne descend pas trop bas, pas de baisse pendant le ménage
  plancher:       { label: 'Plancher chauffant', prechauffage_h: 12, seuil_inoccupe_h: 72, temp_confort: 20, temp_eco: 18, temp_inoccupe: 15, duree_menage_h: 0 },
  // Radiateurs à eau sur pompe à chaleur : eau tiède, montée plus lente que l'électrique
  pac_radiateurs: { label: 'Radiateurs sur pompe à chaleur', prechauffage_h: 3, seuil_inoccupe_h: 36, temp_confort: 20, temp_eco: 17, temp_inoccupe: 15, duree_menage_h: 2 },
  // Radiateurs électriques : réaction rapide, préchauffage court, on coupe vite
  radiateurs:     { label: 'Radiateurs électriques', prechauffage_h: 2, seuil_inoccupe_h: 24, temp_confort: 20, temp_eco: 16, temp_inoccupe: 12, duree_menage_h: 3 },
  pac:            { label: 'Pompe à chaleur air/air (clim réversible)', prechauffage_h: 2, seuil_inoccupe_h: 24, temp_confort: 20, temp_eco: 17, temp_inoccupe: 14, duree_menage_h: 2 },
  autre:          { label: 'Autre', prechauffage_h: 4, seuil_inoccupe_h: 36, temp_confort: 20, temp_eco: 17, temp_inoccupe: 12, duree_menage_h: 3 }
};

var H_MS = 3600000;

function reglagesDomo_() {
  var parBien = {};
  lire_('Domotique').forEach(function (r) { parBien[r.bien_id] = r; });
  return tousBiens_().map(function (b) {
    var r = parBien[b.id] || {};
    var o = { bien_id: b.id, nom: b.nom, _row: r._row,
              heure_arrivee: b.heure_arrivee || '16:00', heure_depart: b.heure_depart || '11:00' };
    Object.keys(DOMO_DEFAUT).forEach(function (k) {
      var v = r[k];
      o[k] = (v === '' || v === undefined || v === null) ? DOMO_DEFAUT[k] : v;
      if (CHAMPS_TEXTE_DOMO.indexOf(k) < 0) o[k] = Number(o[k]) || 0;
    });
    o.groupe_ecs = String(o.groupe_ecs || '').toUpperCase();
    return o;
  });
}

/** 'aaaa-mm-jj' + 'HH:MM' → Date (fuseau du script : Europe/Paris). */
function dateHeure_(jour, heure) {
  var p = String(jour).split('-');
  var m = String(heure || '').match(/(\d{1,2}):(\d{2})/) || [0, 0, 0];
  return new Date(+p[0], +p[1] - 1, +p[2], +m[1], +m[2]);
}

function isoTZ_(d) {
  return d ? Utilities.formatDate(d, TZ, "yyyy-MM-dd'T'HH:mm:ssXXX") : null;
}

function consigne_(mode, cfg) {
  if (mode === 'confort') return cfg.temp_confort;
  if (mode === 'eco' || mode === 'menage') return cfg.temp_eco;
  if (mode === 'inoccupe') return cfg.temp_inoccupe;
  return null;
}

/** État voulu à l'instant t pour un logement. sejours = [{a: Date, d: Date, r}] triés. */
function etatA_(t, sejours, cfg) {
  var cur = null, next = null, prev = null;
  for (var i = 0; i < sejours.length; i++) {
    var s = sejours[i];
    if (s.a <= t && t < s.d) cur = s;
    if (s.a > t && !next) next = s;
    if (s.d <= t) prev = s;
  }
  var e;
  if (cur) {
    e = { mode: 'confort', ecs: 'on', ecs_prioritaire: false, raison: 'Séjour en cours' };
  } else {
    var avant = next ? (next.a - t) : Infinity;
    var relance = avant <= cfg.ecs_avance_h * H_MS;
    e = { ecs: relance ? 'on' : 'off', ecs_prioritaire: relance };
    if (avant <= cfg.prechauffage_h * H_MS) {
      e.mode = 'confort'; e.raison = 'Préchauffage avant l\'arrivée';
    } else if (prev && (t - prev.d) < cfg.duree_menage_h * H_MS) {
      e.mode = 'menage'; e.raison = 'Ménage après le départ';
    } else if (avant <= cfg.seuil_inoccupe_h * H_MS) {
      e.mode = 'eco'; e.raison = 'Logement vide, arrivée proche';
    } else {
      e.mode = 'inoccupe'; e.raison = next ? 'Logement vide jusqu\'au ' + Utilities.formatDate(next.a, TZ, 'dd/MM HH:mm') : 'Aucune réservation à venir';
    }
  }
  if (cfg.chauffage === 'non') e.mode = 'arret';
  e.consigne = consigne_(e.mode, cfg);
  e.sejour = cur; e.suivant = next;
  return e;
}

/** Instants où l'état d'un logement peut changer, entre t et l'horizon. */
function instantsChangement_(sejours, cfg, t, horizon) {
  var out = [];
  sejours.forEach(function (s) {
    [s.a - cfg.prechauffage_h * H_MS, s.a - cfg.ecs_avance_h * H_MS, s.a - cfg.seuil_inoccupe_h * H_MS,
     s.a.getTime(), s.d.getTime(), s.d.getTime() + cfg.duree_menage_h * H_MS]
      .forEach(function (x) { if (x > t && x <= horizon) out.push(x); });
  });
  return out;
}

function trierUniques_(liste) {
  var vu = {};
  return liste.filter(function (x) { if (vu[x]) return false; vu[x] = true; return true; }).sort(function (a, b) { return a - b; });
}

/** État de l'eau chaude d'un groupe = « OU » des besoins de ses logements. */
function etatEcsGroupe_(t, membres) {
  var on = false, prio = false, qui = [], cfgRef = membres[0].cfg;
  var relance = 0, marche = 0, arret = 0;
  membres.forEach(function (m) {
    var e = etatA_(t, m.sejours, m.cfg);
    relance = Math.max(relance, m.cfg.ecs_temp_relance);
    marche = Math.max(marche, m.cfg.ecs_temp_marche);
    arret = Math.max(arret, m.cfg.ecs_temp_arret);
    if (e.ecs === 'on') { on = true; qui.push(m.cfg.nom + (e.ecs_prioritaire ? ' (arrivée proche)' : ' (séjour)')); }
    if (e.ecs_prioritaire) prio = true;
  });
  var etat = prio ? 'relance' : (on ? 'marche' : 'arret');
  return {
    etat: etat, ecs: on ? 'on' : 'off', ecs_prioritaire: prio,
    consigne_ecs: etat === 'relance' ? relance : (etat === 'marche' ? marche : arret),
    raison: on ? 'Besoin : ' + qui.join(', ') : 'Aucun voyageur ni arrivée proche',
    _ref: cfgRef
  };
}

/** Calcule l'état actuel + les prochains changements : chauffage par logement, eau chaude par groupe. */
function calculDomotique_(maintenant) {
  var t = maintenant || new Date(), tt = t.getTime(), horizon = tt + 14 * 24 * H_MS;
  var resas = resasActives_(lire_('Reservations'));
  var biens = {}, groupes = {};

  reglagesDomo_().forEach(function (cfg) {
    if (cfg.actif === 'non') return;
    var sejours = resas.filter(function (r) { return r.bien_id === cfg.bien_id; }).map(function (r) {
      return { a: dateHeure_(r.arrivee, cfg.heure_arrivee), d: dateHeure_(r.depart, cfg.heure_depart), r: r };
    }).filter(function (s) { return s.d.getTime() > tt - 30 * 24 * H_MS; })
      .sort(function (x, y) { return x.a - y.a; });

    var e = etatA_(t, sejours, cfg);
    var planning = [], dernier = e;
    trierUniques_(instantsChangement_(sejours, cfg, tt, horizon)).forEach(function (x) {
      var f = etatA_(new Date(x), sejours, cfg);
      if (f.mode !== dernier.mode || f.consigne !== dernier.consigne) {
        planning.push({ quand: isoTZ_(new Date(x)), mode: f.mode, consigne: f.consigne, raison: f.raison });
        dernier = f;
      }
    });
    var cible = e.sejour || e.suivant;
    var g = cfg.groupe_ecs || cfg.bien_id;
    biens[cfg.bien_id] = {
      nom: cfg.nom, mode: e.mode, consigne: e.consigne, occupe: !!e.sejour, raison: e.raison,
      temp_confort: cfg.temp_confort, temp_eco: cfg.temp_eco,
      groupe_ecs: g,
      voyageurs: cible && cible.r.voyageurs !== '' ? Number(cible.r.voyageurs) : null,
      arrivee: e.suivant ? isoTZ_(e.suivant.a) : null,
      depart: e.sejour ? isoTZ_(e.sejour.d) : (e.suivant ? isoTZ_(e.suivant.d) : null),
      prochain_changement: planning.length ? planning[0].quand : null,
      prochain_mode: planning.length ? planning[0].mode : null,
      prochaine_consigne: planning.length ? planning[0].consigne : null,
      planning: planning.slice(0, 12)
    };
    (groupes[g] = groupes[g] || []).push({ cfg: cfg, sejours: sejours });
  });

  var ecs = {};
  Object.keys(groupes).forEach(function (g) {
    var membres = groupes[g];
    var e = etatEcsGroupe_(t, membres);
    var instants = [];
    membres.forEach(function (m) { instants = instants.concat(instantsChangement_(m.sejours, m.cfg, tt, horizon)); });
    var planning = [], dernier = e;
    trierUniques_(instants).forEach(function (x) {
      var f = etatEcsGroupe_(new Date(x), membres);
      if (f.etat !== dernier.etat || f.consigne_ecs !== dernier.consigne_ecs) {
        planning.push({ quand: isoTZ_(new Date(x)), etat: f.etat, consigne_ecs: f.consigne_ecs, raison: f.raison });
        dernier = f;
      }
    });
    ecs[g] = {
      logements: membres.map(function (m) { return m.cfg.bien_id; }),
      etat: e.etat, ecs: e.ecs, ecs_prioritaire: e.ecs_prioritaire, consigne_ecs: e.consigne_ecs, raison: e.raison,
      prochain_changement: planning.length ? planning[0].quand : null,
      prochain_etat: planning.length ? planning[0].etat : null,
      prochaine_consigne_ecs: planning.length ? planning[0].consigne_ecs : null,
      planning: planning.slice(0, 12)
    };
  });
  return { biens: biens, eau_chaude: ecs };
}

/** Compatibilité : état des logements seuls. */
function etatsDomotique_(maintenant) { return calculDomotique_(maintenant).biens; }

/* ── Accès Home Assistant (lecture seule, protégé par une clé) ── */

function cleDomotique_(regenerer) {
  var cle = params_().cle_domotique;
  if (!cle || regenerer) { cle = aleatoire_(32); setParam_('cle_domotique', cle); }
  return cle;
}

function memeCle_(a, b) {
  a = String(a || ''); b = String(b || '');
  if (!a || a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** doGet(?ha=CLE[&format=ics][&bien=ID]) */
function reponseDomotique_(p) {
  if (!memeCle_(p.ha, params_().cle_domotique)) {
    return ContentService.createTextOutput(JSON.stringify({ erreur: 'clé invalide' })).setMimeType(ContentService.MimeType.JSON);
  }
  if (p.format === 'ics') return ContentService.createTextOutput(icsDomotique_(p.bien)).setMimeType(ContentService.MimeType.ICAL);
  var c = calculDomotique_();
  return ContentService.createTextOutput(JSON.stringify({ genere_le: isoTZ_(new Date()), biens: c.biens, eau_chaude: c.eau_chaude }))
    .setMimeType(ContentService.MimeType.JSON);
}

/** Calendrier des séjours (pour l'intégration « Calendrier distant » de Home Assistant). */
function icsDomotique_(bienId) {
  var cfgs = {};
  reglagesDomo_().forEach(function (c) { cfgs[c.bien_id] = c; });
  var depuis = ajouterJours_(aujourdhui_(), -30);
  var fmt = function (d) { return Utilities.formatDate(d, 'UTC', "yyyyMMdd'T'HHmmss'Z'"); };
  var l = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Mes Locations//FR', 'CALSCALE:GREGORIAN'];
  resasActives_(lire_('Reservations')).forEach(function (r) {
    var c = cfgs[r.bien_id];
    if (!c || c.actif === 'non' || (bienId && r.bien_id !== bienId) || r.depart < depuis) return;
    l.push('BEGIN:VEVENT', 'UID:' + r.id + '@mes-locations', 'DTSTAMP:' + fmt(new Date()),
      'DTSTART:' + fmt(dateHeure_(r.arrivee, c.heure_arrivee)), 'DTEND:' + fmt(dateHeure_(r.depart, c.heure_depart)),
      'SUMMARY:' + (c.nom + ' — occupé' + (r.voyageurs ? ' (' + r.voyageurs + ' pers.)' : '')).replace(/[,;]/g, ' '),
      'END:VEVENT');
  });
  l.push('END:VCALENDAR');
  return l.join('\r\n') + '\r\n';
}

/* ── Actions de l'interface (admin) ── */

function actDomotique_() {
  var url = urlApp_(), cle = cleDomotique_(false), c = calculDomotique_();
  return {
    reglages: reglagesDomo_().map(function (r) { delete r._row; return r; }),
    presets: PRESETS_CHAUFFAGE,
    etats: c.biens,
    eau_chaude: c.eau_chaude,
    url_json: url ? url + '?ha=' + cle : '',
    url_ics: url ? url + '?ha=' + cle + '&format=ics' : ''
  };
}

function actDomotiqueSave_(u, p) {
  var cfg = reglagesDomo_().filter(function (r) { return r.bien_id === p.bien_id; })[0];
  if (!cfg) throw new Error('Bien introuvable.');
  var o = { bien_id: cfg.bien_id, _row: cfg._row };
  Object.keys(DOMO_DEFAUT).forEach(function (k) {
    var v = p[k] !== undefined ? p[k] : cfg[k];
    if (k === 'type_chauffage') o[k] = PRESETS_CHAUFFAGE[v] ? v : 'autre';
    else if (k === 'groupe_ecs') o[k] = String(v || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
    else if (CHAMPS_TEXTE_DOMO.indexOf(k) >= 0) o[k] = v === 'non' ? 'non' : 'oui';
    else o[k] = Number(String(v).replace(',', '.')) || 0;
  });
  if (o.temp_inoccupe < 5) throw new Error('Gardez au moins 5 °C en inoccupé (risque de gel).');
  if (o.ecs_temp_relance < 55) throw new Error('La relance d\'eau chaude doit atteindre au moins 55 °C (sécurité sanitaire).');
  sauver_('Domotique', o);
  journal_(u.identifiant, 'domotique', cfg.bien_id);
  return true;
}
