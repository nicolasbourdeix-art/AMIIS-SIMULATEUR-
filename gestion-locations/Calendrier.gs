/**
 * Calendrier.gs — Import des calendriers Airbnb (iCal), détection des conflits de ménage.
 *
 * Airbnb : Annonce → Disponibilités → Synchronisation des calendriers → « Exporter le calendrier »
 * donne une adresse .ics à coller dans Réglages → Biens. Le fichier iCal contient les dates
 * et le code de réservation, mais PAS les montants (à saisir dans l'onglet Réservations).
 */

/* ── Lecture d'un fichier iCal ──────────────────────────── */

function icalDate_(v) {
  var m = String(v || '').match(/(\d{4})(\d{2})(\d{2})/);
  return m ? m[1] + '-' + m[2] + '-' + m[3] : '';
}

function icalTexte_(v) {
  return String(v || '').replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
}

function parserIcal_(texte) {
  var lignes = String(texte).replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  var evs = [], cur = null;
  lignes.forEach(function (l) {
    if (l === 'BEGIN:VEVENT') { cur = {}; return; }
    if (l === 'END:VEVENT') { if (cur) evs.push(cur); cur = null; return; }
    if (!cur) return;
    var i = l.indexOf(':');
    if (i < 0) return;
    cur[l.slice(0, i).split(';')[0].toUpperCase()] = l.slice(i + 1);
  });
  return evs.map(function (e) {
    var resume = icalTexte_(e.SUMMARY);
    var desc = icalTexte_(e.DESCRIPTION);
    var code = (desc.match(/details\/([A-Z0-9]{6,})/i) || [])[1] || '';
    var tel4 = (desc.match(/Last 4 Digits\)?\s*:\s*(\d{4})/i) || desc.match(/4 derniers chiffres\)?\s*:\s*(\d{4})/i) || [])[1] || '';
    var bloque = /not available|indisponible|blocked|bloqu/i.test(resume) && !code;
    return {
      uid: e.UID || '',
      arrivee: icalDate_(e.DTSTART),
      depart: icalDate_(e.DTEND),
      resume: resume,
      code: code,
      tel4: tel4,
      type: bloque ? 'blocage' : 'reservation'
    };
  }).filter(function (e) { return e.arrivee && e.depart && e.depart > e.arrivee; });
}

/* ── Synchronisation ─────────────────────────────────────── */

function synchroniser_() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var p = params_();
    var ignorerBlocages = p.ignorer_blocages !== 'non';
    var biens = tousBiens_();
    var resas = lire_('Reservations');
    var auj = aujourdhui_();
    var rapport = [];

    biens.forEach(function (b) {
      var urls = String(b.ical_urls || '').split(/[\s,;]+/).filter(function (u) { return /^https?:\/\//.test(u); });
      if (!urls.length) return;
      var r = { bien: b.nom, nouvelles: 0, modifiees: 0, annulees: 0, erreur: '' };
      var vus = {}, toutOk = true;

      urls.forEach(function (url) {
        var evs;
        try {
          var rep = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
          if (rep.getResponseCode() !== 200) throw new Error('HTTP ' + rep.getResponseCode());
          evs = parserIcal_(rep.getContentText());
        } catch (e) {
          toutOk = false;
          r.erreur += (r.erreur ? ' · ' : '') + e.message;
          return;
        }
        var source = /airbnb/i.test(url) ? 'airbnb' : (/booking/i.test(url) ? 'booking' : 'ical');
        evs.forEach(function (ev) {
          if (ev.type === 'blocage' && ignorerBlocages) return;
          vus[ev.uid] = true;
          var ex = resas.filter(function (x) {
            return x.bien_id === b.id && ((ev.uid && x.uid === ev.uid) || (ev.code && x.code === ev.code));
          })[0];
          if (ex) {
            var change = ex.arrivee !== ev.arrivee || ex.depart !== ev.depart || ex.statut === 'annulée';
            if (change) {
              ex.arrivee = ev.arrivee; ex.depart = ev.depart;
              ex.nuits = ecartJours_(ev.arrivee, ev.depart);
              ex.statut = 'confirmée'; ex.maj_le = maintenant_();
              r.modifiees++;
            }
            ex.uid = ev.uid; ex.code = ev.code || ex.code; ex.tel4 = ev.tel4 || ex.tel4; ex.type = ev.type;
          } else {
            resas.push({
              id: b.id + '-' + (ev.code || sha_(ev.uid).slice(0, 10)),
              bien_id: b.id, source: source, type: ev.type, uid: ev.uid, code: ev.code,
              voyageur: ev.type === 'blocage' ? 'Bloqué' : '', arrivee: ev.arrivee, depart: ev.depart,
              nuits: ecartJours_(ev.arrivee, ev.depart), voyageurs: '', montant: '',
              statut: 'confirmée', notes: '', tel4: ev.tel4, maj_le: maintenant_()
            });
            r.nouvelles++;
          }
        });
      });

      // Réservations futures disparues du calendrier = annulées (seulement si tous les flux ont répondu)
      if (toutOk) {
        resas.forEach(function (x) {
          if (x.bien_id === b.id && x.source !== 'manuel' && x.uid && !vus[x.uid] &&
              x.depart >= auj && x.statut !== 'annulée') {
            x.statut = 'annulée'; x.maj_le = maintenant_(); r.annulees++;
          }
        });
      }
      rapport.push(r);
    });

    resas.sort(function (a, b) { return a.arrivee < b.arrivee ? -1 : a.arrivee > b.arrivee ? 1 : 0; });
    ecrireTout_('Reservations', resas);
    setParam_('derniere_synchro', maintenant_());
    return { date: maintenant_(), biens: rapport };
  } finally {
    lock.releaseLock();
  }
}

/* ── Conflits ────────────────────────────────────────────── */

function resasActives_(resas) {
  return resas.filter(function (r) { return r.statut !== 'annulée' && r.type !== 'blocage'; });
}

/**
 * Règle principale (paramètre regle_1_logement_par_jour, activé par défaut) : la personne du ménage prépare
 * au plus UN logement par jour ; chaque ménage doit être fait entre le départ des voyageurs et la prochaine
 * arrivée dans ce logement. Conflit seulement s'il est impossible de tout caser (voir planningMenage_).
 * Si la règle est désactivée, règles simples :
 *  - 2 départs le même jour  → deux ménages à faire le même jour : impossible
 *  - 2 arrivées le même jour → deux logements à préparer pour le même jour : impossible
 *  - chevauchement dans un même bien (double réservation)
 */
function conflits_(resas, biens, p) {
  p = p || params_();
  var groupe = {}, nom = {};
  biens.forEach(function (b) { nom[b.id] = b.nom; if (b.groupe_menage) groupe[b.id] = b.groupe_menage; });
  var actives = resasActives_(resas);
  var parJour = {}, out = [];

  actives.forEach(function (r) {
    var g = groupe[r.bien_id];
    if (!g) return;
    [['depart', r.depart], ['arrivee', r.arrivee]].forEach(function (t) {
      var k = g + '|' + t[1];
      if (!parJour[k]) parJour[k] = { groupe: g, date: t[1], depart: [], arrivee: [] };
      parJour[k][t[0]].push(r);
    });
  });

  var unParJour = p.regle_1_logement_par_jour !== 'non';
  if (unParJour) out = out.concat(planningMenage_(actives, biens).conflits);
  Object.keys(parJour).forEach(function (k) {
    var e = parJour[k];
    if (unParJour) return;
    [['depart', p.regle_2_departs !== 'non', 'départs'], ['arrivee', p.regle_2_arrivees !== 'non', 'arrivées']]
      .forEach(function (t) {
        if (!t[1]) return;
        var liste = e[t[0]], ids = {};
        liste.forEach(function (r) { ids[r.bien_id] = true; });
        var distincts = Object.keys(ids);
        if (distincts.length < 2) return;
        out.push({
          cle: e.groupe + '|' + e.date + '|' + t[0], date: e.date, groupe: e.groupe, type: t[0],
          biens: distincts, reservations: liste.map(function (r) { return r.id; }),
          message: distincts.length + ' ' + t[2] + ' le même jour (' + distincts.map(function (i) { return nom[i] || i; }).join(' + ') +
                   ') : pas le temps de préparer les deux logements.'
        });
      });
  });

  // Chevauchements dans un même bien
  var parBien = {};
  actives.forEach(function (r) { (parBien[r.bien_id] = parBien[r.bien_id] || []).push(r); });
  Object.keys(parBien).forEach(function (bid) {
    var l = parBien[bid].sort(function (a, b) { return a.arrivee < b.arrivee ? -1 : 1; });
    for (var i = 1; i < l.length; i++) {
      for (var j = 0; j < i; j++) {
        if (l[i].arrivee < l[j].depart && l[j].arrivee < l[i].depart) {
          out.push({
            cle: bid + '|' + l[i].arrivee + '|chevauchement|' + l[j].id + '|' + l[i].id, date: l[i].arrivee,
            groupe: groupe[bid] || '', type: 'chevauchement', biens: [bid], reservations: [l[j].id, l[i].id],
            message: 'Deux réservations se chevauchent dans ' + (nom[bid] || bid) + '.'
          });
        }
      }
    }
  });

  return out.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
}

/**
 * Planning des ménages d'un groupe (une personne, un logement par jour).
 * Chaque ménage = une fenêtre [jour du départ, jour de la prochaine arrivée dans ce logement].
 * On remplit les jours un par un en prenant à chaque fois le ménage le plus urgent (échéance la plus proche) :
 * cette méthode trouve toujours une solution quand il en existe une. Un ménage qui ne peut pas être placé
 * avant son échéance = conflit.
 * Renvoie { jours: {reservation_id: 'aaaa-mm-jj'}, conflits: [...] }.
 */
function planningMenage_(actives, biens) {
  var groupe = {}, nom = {};
  biens.forEach(function (b) { nom[b.id] = b.nom; groupe[b.id] = b.groupe_menage || ('__' + b.id); });
  var parBien = {};
  actives.forEach(function (r) { (parBien[r.bien_id] = parBien[r.bien_id] || []).push(r); });
  var taches = {};
  Object.keys(parBien).forEach(function (bid) {
    var l = parBien[bid].slice().sort(function (a, b) { return a.arrivee < b.arrivee ? -1 : a.arrivee > b.arrivee ? 1 : 0; });
    l.forEach(function (r) {
      var suiv = null;
      l.forEach(function (x) { if (x !== r && x.arrivee >= r.depart && (!suiv || x.arrivee < suiv.arrivee)) suiv = x; });
      var g = groupe[bid] || ('__' + bid);
      (taches[g] = taches[g] || []).push({ id: r.id, bien: bid, debut: r.depart, fin: suiv ? suiv.arrivee : null, suivante: suiv ? suiv.id : null });
    });
  });

  var jours = {}, conflits = [];
  Object.keys(taches).forEach(function (g) {
    var t = taches[g].sort(function (a, b) { return a.debut < b.debut ? -1 : a.debut > b.debut ? 1 : 0; });
    var i = 0, attente = [], jour = t.length ? t[0].debut : null, occupe = {}, echecs = [];
    while (i < t.length || attente.length) {
      if (!attente.length && t[i].debut > jour) jour = t[i].debut;
      while (i < t.length && t[i].debut <= jour) attente.push(t[i++]);
      attente = attente.filter(function (x) { if (x.fin && x.fin < jour) { echecs.push(x); return false; } return true; });
      if (!attente.length) continue;
      var k = 0;
      for (var j = 1; j < attente.length; j++) {
        var a = attente[j], b = attente[k];
        if ((a.fin || '9999') < (b.fin || '9999')) k = j;
      }
      var choisi = attente.splice(k, 1)[0];
      jours[choisi.id] = jour; occupe[jour] = choisi;
      jour = ajouterJours_(jour, 1);
    }
    if (g.indexOf('__') === 0) return; // logement seul : jamais de conflit de planning
    echecs.forEach(function (x) {
      var pris = [], ids = {};
      ids[x.id] = true; if (x.suivante) ids[x.suivante] = true;
      for (var d = x.debut; d <= x.fin; d = ajouterJours_(d, 1)) {
        if (occupe[d]) {
          pris.push('« ' + (nom[occupe[d].bien] || occupe[d].bien) + ' » le ' + fr_(d).slice(0, 5));
          ids[occupe[d].id] = true; if (occupe[d].suivante) ids[occupe[d].suivante] = true;
        }
      }
      var bs = {};
      bs[x.bien] = true;
      Object.keys(ids).forEach(function (id) { var o = taches[g].filter(function (y) { return y.id === id; })[0]; if (o) bs[o.bien] = true; });
      conflits.push({
        cle: g + '|' + x.fin + '|menage|' + x.id, date: x.fin, groupe: g, type: 'menage',
        biens: Object.keys(bs), reservations: Object.keys(ids),
        message: 'Ménage impossible à caser pour « ' + (nom[x.bien] || x.bien) + ' » : départ le ' + fr_(x.debut).slice(0, 5) +
                 ', voyageurs suivants le ' + fr_(x.fin).slice(0, 5) + (pris.length ? ', et ces jours-là le ménage est déjà pris (' + pris.join(', ') + ')' : '') +
                 '. Un seul logement peut être préparé par jour.'
      });
    });
  });
  return { jours: jours, conflits: conflits };
}

/** « Est-ce que je peux accepter cette demande ? » — simule une réservation et renvoie les conflits qu'elle créerait. */
function verifierDemande_(bienId, arrivee, depart) {
  if (!estDate_(arrivee) || !estDate_(depart) || depart <= arrivee) throw new Error('Dates invalides.');
  var biens = tousBiens_();
  var resas = lire_('Reservations');
  var test = { id: '__DEMANDE__', bien_id: bienId, arrivee: arrivee, depart: depart, statut: 'confirmée', type: 'reservation' };
  var res = conflits_(resas.concat([test]), biens).filter(function (c) {
    return c.reservations.indexOf('__DEMANDE__') >= 0;
  });
  var nom = {};
  biens.forEach(function (b) { nom[b.id] = b.nom; });
  // Conseil : écart avec les réservations voisines du même groupe
  return {
    ok: res.length === 0,
    conflits: res,
    message: res.length ? res.map(function (c) { return '⚠️ ' + fr_(c.date) + ' — ' + c.message; }).join('\n')
                        : '✅ Aucun conflit : ' + (nom[bienId] || bienId) + ' du ' + fr_(arrivee) + ' au ' + fr_(depart) + ' (' + ecartJours_(arrivee, depart) + ' nuits).'
  };
}

function fr_(d) {
  var p = String(d).split('-');
  return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : d;
}

/* ── Tâches automatiques (déclencheurs) ─────────────────── */

/** Toutes les heures : synchro Airbnb + email si un nouveau conflit apparaît. */
function syncAuto() {
  synchroniser_();
  try { importerMontantsEmails_(); } catch (e) { console.error('Import emails : ' + e.message); }
  synchroniserExportSilencieux_();
  alerterConflits_();
}

function alerterConflits_() {
  var p = params_();
  var auj = aujourdhui_();
  var biens = tousBiens_();
  var futurs = conflits_(lire_('Reservations'), biens, p).filter(function (c) { return c.date >= auj; });
  var props = PropertiesService.getScriptProperties();
  var deja = {};
  try { deja = JSON.parse(props.getProperty('ALERTES_ENVOYEES') || '{}'); } catch (e) { deja = {}; }
  var nouveaux = futurs.filter(function (c) { return !deja[c.cle]; });

  var garde = {};
  futurs.forEach(function (c) { garde[c.cle] = deja[c.cle] || maintenant_(); });

  var dest = String(p.email_alertes || '').trim();
  if (nouveaux.length && dest) {
    var corps = 'Bonjour,\n\nNouveau(x) conflit(s) détecté(s) dans le planning :\n\n' +
      nouveaux.map(function (c) { return '• ' + fr_(c.date) + ' — ' + c.message; }).join('\n') +
      '\n\nOuvrez l\'application pour voir le détail : ' + urlApp_() + '\n';
    MailApp.sendEmail(dest, '⚠️ ' + (p.nom_app || 'Locations') + ' — conflit de ménage', corps);
  }
  props.setProperty('ALERTES_ENVOYEES', JSON.stringify(garde));
  return nouveaux.length;
}

/** Chaque soir à 18h : programme du lendemain envoyé aux personnes « Ménage ». */
function rappelMenages() {
  var p = params_();
  if (p.rappel_menage === 'non') return;
  var demain = ajouterJours_(aujourdhui_(), 1);
  var biens = tousBiens_(), nom = {};
  biens.forEach(function (b) { nom[b.id] = b; });
  var resas = resasActives_(lire_('Reservations'));
  lire_('Utilisateurs').forEach(function (u) {
    if (u.role !== 'menage' || u.actif === 'non' || !u.email) return;
    var mes = String(u.biens || '').split(',').map(function (s) { return s.trim(); });
    var tous = mes.indexOf('*') >= 0;
    var lignes = [];
    var jours = planningMenage_(resas, biens).jours;
    resas.forEach(function (r) {
      if (!tous && mes.indexOf(r.bien_id) < 0) return;
      var b = nom[r.bien_id] || { nom: r.bien_id };
      if (jours[r.id] === demain) lignes.push('🧹 Ménage ' + b.nom + (r.depart === demain ? ' — départ des voyageurs ' + (b.heure_depart || '11:00') : ' — logement libre depuis le ' + fr_(r.depart).slice(0, 5)));
      if (r.arrivee === demain) lignes.push('🔑 Arrivée ' + b.nom + ' — ' + (b.heure_arrivee || '16:00') + (r.voyageurs ? ' · ' + r.voyageurs + ' pers.' : ''));
    });
    if (!lignes.length) return;
    MailApp.sendEmail(u.email, '🧹 Programme de demain (' + fr_(demain) + ')',
      'Bonjour ' + (u.nom || '') + ',\n\nDemain :\n\n' + lignes.join('\n') + '\n\nDétails : ' + urlApp_() + '\n');
  });
}

function urlApp_() {
  try { return ScriptApp.getService().getUrl() || ''; } catch (e) { return ''; }
}
