/**
 * Domotique.gs — Consignes de chauffage et d'eau chaude (ECS) calculées à partir des réservations,
 * lues par Home Assistant (capteur REST) toutes les quelques minutes.
 *
 * Modes de chauffage :
 *   confort  → séjour en cours, ou préchauffage avant une arrivée
 *   menage   → quelques heures après un départ (température éco, le temps du ménage)
 *   eco      → logement vide mais prochaine arrivée proche (on ne laisse pas refroidir les murs)
 *   inoccupe → logement vide pour un moment (température basse / hors-gel)
 *   arret    → chauffage désactivé pour ce logement (été)
 * Eau chaude :
 *   ecs = 'on' pendant le séjour et pendant la relance avant l'arrivée, 'off' sinon.
 *   ecs_prioritaire = true pendant la relance avant l'arrivée : chauffer même hors heures creuses.
 */

var DOMO_DEFAUT = {
  actif: 'oui',          // envoyer ce logement à Home Assistant
  type_chauffage: 'autre', // plancher | radiateurs | pac | autre (sert aux valeurs conseillées)
  chauffage: 'oui',      // 'non' = mode « arret » (été)
  prechauffage_h: 4,     // heures de préchauffage avant l'arrivée
  ecs_avance_h: 8,       // heures de relance du ballon avant l'arrivée
  temp_confort: 20,
  temp_eco: 17,
  temp_inoccupe: 12,
  seuil_inoccupe_h: 36,  // si la prochaine arrivée est à moins de X h, on reste en éco
  duree_menage_h: 3      // heures en mode « ménage » après le départ
};

/** Valeurs conseillées selon le type de chauffage (appliquées depuis l'interface). */
var PRESETS_CHAUFFAGE = {
  // Forte inertie : on préchauffe longtemps, on ne descend pas trop bas, pas de baisse pendant le ménage
  plancher:   { label: 'Plancher chauffant', prechauffage_h: 12, seuil_inoccupe_h: 72, temp_confort: 20, temp_eco: 18, temp_inoccupe: 15, duree_menage_h: 0, ecs_avance_h: 8 },
  // Réaction rapide : préchauffage court, on coupe vite
  radiateurs: { label: 'Radiateurs électriques', prechauffage_h: 2, seuil_inoccupe_h: 24, temp_confort: 20, temp_eco: 16, temp_inoccupe: 12, duree_menage_h: 3, ecs_avance_h: 8 },
  pac:        { label: 'Pompe à chaleur / clim réversible', prechauffage_h: 4, seuil_inoccupe_h: 36, temp_confort: 20, temp_eco: 17, temp_inoccupe: 14, duree_menage_h: 2, ecs_avance_h: 8 },
  autre:      { label: 'Autre', prechauffage_h: 4, seuil_inoccupe_h: 36, temp_confort: 20, temp_eco: 17, temp_inoccupe: 12, duree_menage_h: 3, ecs_avance_h: 8 }
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
      o[k] = (r[k] === '' || r[k] === undefined || r[k] === null) ? DOMO_DEFAUT[k] : r[k];
    });
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
  if (mode === 'confort') return Number(cfg.temp_confort);
  if (mode === 'eco' || mode === 'menage') return Number(cfg.temp_eco);
  if (mode === 'inoccupe') return Number(cfg.temp_inoccupe);
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
    var ecsOn = avant <= cfg.ecs_avance_h * H_MS;
    e = { ecs: ecsOn ? 'on' : 'off', ecs_prioritaire: ecsOn };
    if (avant <= cfg.prechauffage_h * H_MS) {
      e.mode = 'confort'; e.raison = 'Préchauffage avant l\'arrivée';
    } else if (prev && (t - prev.d) < cfg.duree_menage_h * H_MS) {
      e.mode = 'menage'; e.raison = 'Ménage après le départ';
    } else if (avant <= cfg.seuil_inoccupe_h * H_MS) {
      e.mode = 'eco'; e.raison = 'Logement vide, arrivée proche';
    } else {
      e.mode = 'inoccupe'; e.raison = next ? 'Logement vide jusqu\'au ' + Utilities.formatDate(next.a, TZ, 'dd/MM HH:mm') : 'Aucune réservation à venir';
    }
    if (ecsOn) e.raison += ' · relance de l\'eau chaude';
  }
  if (cfg.chauffage === 'non') e.mode = 'arret';
  e.consigne = consigne_(e.mode, cfg);
  e.sejour = cur; e.suivant = next;
  return e;
}

/** Calcule l'état actuel + les prochains changements pour chaque logement actif. */
function etatsDomotique_(maintenant) {
  var t = maintenant || new Date();
  var resas = resasActives_(lire_('Reservations'));
  var out = {};
  reglagesDomo_().forEach(function (cfg) {
    if (cfg.actif === 'non') return;
    ['prechauffage_h', 'ecs_avance_h', 'seuil_inoccupe_h', 'duree_menage_h'].forEach(function (k) { cfg[k] = Number(cfg[k]) || 0; });
    var sejours = resas.filter(function (r) { return r.bien_id === cfg.bien_id; }).map(function (r) {
      return { a: dateHeure_(r.arrivee, cfg.heure_arrivee), d: dateHeure_(r.depart, cfg.heure_depart), r: r };
    }).filter(function (s) { return s.d > new Date(t.getTime() - 30 * 24 * H_MS); })
      .sort(function (x, y) { return x.a - y.a; });

    var e = etatA_(t, sejours, cfg);

    // Instants où l'état peut changer, sur 14 jours
    var horizon = t.getTime() + 14 * 24 * H_MS, cands = {};
    sejours.forEach(function (s) {
      [s.a - cfg.prechauffage_h * H_MS, s.a - cfg.ecs_avance_h * H_MS, s.a - cfg.seuil_inoccupe_h * H_MS,
       s.a.getTime(), s.d.getTime(), s.d.getTime() + cfg.duree_menage_h * H_MS]
        .forEach(function (x) { if (x > t.getTime() && x <= horizon) cands[x] = true; });
    });
    var planning = [], dernier = e;
    Object.keys(cands).map(Number).sort(function (a, b) { return a - b; }).forEach(function (x) {
      var f = etatA_(new Date(x), sejours, cfg);
      if (f.mode !== dernier.mode || f.ecs !== dernier.ecs || f.ecs_prioritaire !== dernier.ecs_prioritaire) {
        planning.push({ quand: isoTZ_(new Date(x)), mode: f.mode, consigne: f.consigne, ecs: f.ecs, raison: f.raison });
        dernier = f;
      }
    });

    var cible = e.sejour || e.suivant;
    out[cfg.bien_id] = {
      nom: cfg.nom,
      mode: e.mode,
      consigne: e.consigne,
      ecs: e.ecs,
      ecs_prioritaire: e.ecs_prioritaire,
      occupe: !!e.sejour,
      raison: e.raison,
      voyageurs: cible && cible.r.voyageurs !== '' ? Number(cible.r.voyageurs) : null,
      arrivee: e.suivant ? isoTZ_(e.suivant.a) : null,
      depart: e.sejour ? isoTZ_(e.sejour.d) : (e.suivant ? isoTZ_(e.suivant.d) : null),
      prochain_changement: planning.length ? planning[0].quand : null,
      prochain_mode: planning.length ? planning[0].mode : null,
      prochaine_consigne: planning.length ? planning[0].consigne : null,
      prochain_ecs: planning.length ? planning[0].ecs : null,
      planning: planning.slice(0, 12)
    };
  });
  return out;
}

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

/** doGet(?ha=CLE[&bien=ID][&format=ics]) */
function reponseDomotique_(p) {
  if (!memeCle_(p.ha, params_().cle_domotique)) {
    return ContentService.createTextOutput(JSON.stringify({ erreur: 'clé invalide' })).setMimeType(ContentService.MimeType.JSON);
  }
  if (p.format === 'ics') return ContentService.createTextOutput(icsDomotique_(p.bien)).setMimeType(ContentService.MimeType.ICAL);
  var etats = etatsDomotique_();
  if (p.bien) etats = etats[p.bien] ? (function (o) { o[p.bien] = etats[p.bien]; return o; })({}) : {};
  return ContentService.createTextOutput(JSON.stringify({ genere_le: isoTZ_(new Date()), biens: etats }))
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
  var url = urlApp_(), cle = cleDomotique_(false);
  return {
    reglages: reglagesDomo_().map(function (r) { delete r._row; return r; }),
    presets: PRESETS_CHAUFFAGE,
    etats: etatsDomotique_(),
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
    else o[k] = typeof DOMO_DEFAUT[k] === 'number' ? (Number(String(v).replace(',', '.')) || 0) : (v === 'non' ? 'non' : 'oui');
  });
  if (o.temp_inoccupe < 5) throw new Error('Gardez au moins 5 °C en inoccupé (risque de gel).');
  sauver_('Domotique', o);
  journal_(u.identifiant, 'domotique', cfg.bien_id);
  return true;
}
