/**
 * Code.gs — Point d'entrée de l'application web, installation et API.
 *
 * Installation : voir README.md (lancer une fois la fonction installer() depuis l'éditeur).
 */

function doGet(e) {
  if (e && e.parameter && e.parameter.ha) return reponseDomotique_(e.parameter);
  var nom = 'Mes Locations';
  try { nom = params_().nom_app || nom; } catch (e) { /* pas encore installé */ }
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle(nom)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

/* ══════════════════════════════════════════════════════════
 * INSTALLATION — à lancer une fois depuis l'éditeur (▶ Exécuter → installer)
 * ══════════════════════════════════════════════════════════ */

function installer() {
  var props = PropertiesService.getScriptProperties();
  var ss = null, id = props.getProperty('SS_ID');
  if (id) { try { ss = SpreadsheetApp.openById(id); } catch (e) { ss = null; } }
  if (!ss) { try { ss = SpreadsheetApp.getActiveSpreadsheet(); } catch (e) { ss = null; } }
  if (!ss) ss = SpreadsheetApp.create('Mes Locations — Base de données');
  props.setProperty('SS_ID', ss.getId());
  _ssCache = ss;
  ss.setSpreadsheetTimeZone(TZ);

  Object.keys(SCHEMA).forEach(function (nom) {
    var s = ss.getSheetByName(nom) || ss.insertSheet(nom);
    var cols = SCHEMA[nom];
    s.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold').setBackground('#FCEFD9');
    s.setFrozenRows(1);
  });
  var defaut = ss.getSheetByName('Feuille 1') || ss.getSheetByName('Sheet1');
  if (defaut && ss.getSheets().length > 1) ss.deleteSheet(defaut);

  // Paramètres par défaut
  var existants = {};
  lire_('Parametres').forEach(function (p) { existants[p.cle] = true; });
  var moi = '';
  try { moi = Session.getEffectiveUser().getEmail(); } catch (e) { moi = ''; }
  PARAMS_DEFAUT.forEach(function (p) {
    if (!existants[p[0]]) sauver_('Parametres', { cle: p[0], valeur: p[0] === 'email_alertes' ? moi : p[1], description: p[2] });
  });

  // Biens de départ (modifiables ensuite dans Réglages → Biens)
  if (!lire_('Biens').length) {
    [
      { id: 'TILH1', nom: 'Le refuge en bois rustique', ville: 'Tilh', groupe_menage: 'TILH', couleur: '#E8930A',
        regle_type: 'seuil', regle_valeur: 600, regle_base: 'mois', proprietaire: 'Propriétaire Tilh' },
      { id: 'TILH2', nom: 'Le petit chalet landais rustique', ville: 'Tilh', groupe_menage: 'TILH', couleur: '#2E86AB',
        regle_type: 'seuil', regle_valeur: 600, regle_base: 'mois', proprietaire: 'Propriétaire Tilh' },
      { id: 'SOUSTONS', nom: 'Soustons', ville: 'Soustons', groupe_menage: '', couleur: '#3BA55C',
        regle_type: 'total', regle_valeur: 0, regle_base: 'mois', proprietaire: '' }
    ].forEach(function (b) {
      b.ical_urls = ''; b.heure_arrivee = '16:00'; b.heure_depart = '11:00'; b.actif = 'oui';
      sauver_('Biens', b);
    });
  }

  // Comptes de départ
  var comptes = [];
  if (!lire_('Utilisateurs').length) {
    [
      { identifiant: 'nicolas', nom: 'Nicolas', email: moi, role: 'admin', biens: '*' },
      { identifiant: 'laetitia', nom: 'Laetitia', email: '', role: 'menage', biens: 'TILH1,TILH2' },
      { identifiant: 'xavier', nom: 'Xavier', email: '', role: 'gestionnaire', biens: 'SOUSTONS' }
    ].forEach(function (u) {
      var mdp = aleatoire_(10);
      definirMdp_(u, mdp);
      u.actif = 'oui'; u.cree_le = maintenant_();
      sauver_('Utilisateurs', u);
      comptes.push(u.identifiant + ' / ' + mdp);
    });
  }

  dossierRacine_();
  cleDomotique_(false);
  if (!lire_('Domotique').length) {
    // Tilh : une pompe à chaleur pour les deux maisons (plancher chauffant d'un côté, radiateurs de l'autre)
    // et un seul ballon d'eau chaude → même groupe eau chaude « TILH ». Soustons : radiateurs électriques.
    // TILH1 = Le refuge en bois rustique (plancher), TILH2 = Le petit chalet landais rustique (radiateurs).
    [['TILH1', 'plancher', 'TILH'], ['TILH2', 'pac_radiateurs', 'TILH'], ['SOUSTONS', 'radiateurs', '']].forEach(function (x) {
      var o = { bien_id: x[0] };
      Object.keys(DOMO_DEFAUT).forEach(function (k) { o[k] = DOMO_DEFAUT[k]; });
      var pr = PRESETS_CHAUFFAGE[x[1]];
      Object.keys(pr).forEach(function (k) { if (k !== 'label') o[k] = pr[k]; });
      o.type_chauffage = x[1];
      o.groupe_ecs = x[2];
      sauver_('Domotique', o);
    });
  }
  installerDeclencheurs_();

  Logger.log('✅ Installation terminée.');
  Logger.log('Base de données : ' + ss.getUrl());
  if (comptes.length) {
    Logger.log('Mots de passe provisoires (à noter, puis à changer dans l\'appli) :');
    comptes.forEach(function (c) { Logger.log('   ' + c); });
  }
  Logger.log('Étape suivante : Déployer → Nouveau déploiement → Application Web.');
}

function installerDeclencheurs_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (['syncAuto', 'rappelMenages'].indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('syncAuto').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('rappelMenages').timeBased().everyDays(1).atHour(18).create();
}

/** Secours : redéfinir un mot de passe depuis l'éditeur (modifier les deux valeurs puis exécuter). */
function reinitialiserMotDePasse() {
  var IDENTIFIANT = 'nicolas', NOUVEAU = 'changez-moi-123';
  var u = lire_('Utilisateurs').filter(function (x) { return x.identifiant === IDENTIFIANT; })[0];
  if (!u) throw new Error('Utilisateur introuvable');
  definirMdp_(u, NOUVEAU); sauver_('Utilisateurs', u);
  Logger.log('Mot de passe de ' + IDENTIFIANT + ' réinitialisé.');
}

/* ══════════════════════════════════════════════════════════
 * API — toutes les actions de l'interface passent par api(token, action, données)
 * ══════════════════════════════════════════════════════════ */

var TOUS = ['admin', 'gestionnaire', 'menage', 'comptable'];
var GESTION = ['admin', 'gestionnaire'];

var ACTIONS = {
  init:               { roles: TOUS, fn: actInit_ },
  tableau:            { roles: TOUS, fn: actTableau_ },
  calendrier:         { roles: TOUS, fn: actCalendrier_ },
  menages:            { roles: ['admin', 'gestionnaire', 'menage'], fn: actMenages_ },
  menage_statut:      { roles: ['admin', 'gestionnaire', 'menage'], fn: actMenageStatut_ },
  reservations:       { roles: ['admin', 'gestionnaire', 'comptable'], fn: actReservations_ },
  reservation_save:   { roles: GESTION, fn: actReservationSave_ },
  reservation_suppr:  { roles: GESTION, fn: actReservationSuppr_ },
  verifier:           { roles: TOUS, fn: function (u, p) { verifierBien_(u, p.bien_id); return verifierDemande_(p.bien_id, p.arrivee, p.depart); } },
  revenus:            { roles: ['admin', 'gestionnaire', 'comptable'], fn: actRevenus_ },
  documents:          { roles: TOUS, fn: actDocuments_ },
  document_upload:    { roles: TOUS, fn: function (u, p) { return televerserDocument_(u, p); } },
  document_save:      { roles: TOUS, fn: actDocumentSave_ },
  document_suppr:     { roles: TOUS, fn: actDocumentSuppr_ },
  envoyer_comptable:  { roles: ['admin', 'gestionnaire'], fn: function (u, p) { return envoyerComptable_(u, p.ids || []); } },
  synchroniser:       { roles: GESTION, fn: function (u) {
                          var r = synchroniser_();
                          try { r.emails = importerMontantsEmails_(); } catch (e) { r.emails = { erreur: e.message }; }
                          r.alertes = alerterConflits_(); journal_(u.identifiant, 'synchro', JSON.stringify(r.biens)); return r; } },
  emails_import:      { roles: GESTION, fn: function (u) { var r = importerMontantsEmails_(true); journal_(u.identifiant, 'import emails', JSON.stringify(r)); return r; } },
  reglages:           { roles: ['admin'], fn: actReglages_ },
  bien_save:          { roles: ['admin'], fn: actBienSave_ },
  utilisateur_save:   { roles: ['admin'], fn: actUtilisateurSave_ },
  parametres_save:    { roles: ['admin'], fn: actParametresSave_ },
  domotique:          { roles: ['admin'], fn: actDomotique_ },
  domotique_save:     { roles: ['admin'], fn: actDomotiqueSave_ },
  domotique_cle:      { roles: ['admin'], fn: function (u) { cleDomotique_(true); journal_(u.identifiant, 'domotique', 'nouvelle clé'); return actDomotique_(); } },
  mon_mdp:            { roles: TOUS, fn: actMonMdp_ },
  deconnexion:        { roles: TOUS, fn: function (u) { deconnexion_(u.token); return true; } }
};

function api(token, action, donnees) {
  try {
    var a = ACTIONS[action];
    if (!a) throw new Error('Action inconnue : ' + action);
    var u = utilisateur_(token);
    if (a.roles.indexOf(u.role) < 0) throw new Error('Accès refusé pour votre profil.');
    var res = a.fn(u, donnees || {});
    return { ok: true, data: JSON.parse(JSON.stringify(res === undefined ? null : res)) };
  } catch (e) {
    return { ok: false, error: e.message || String(e), auth: !!e.auth };
  }
}

/* ── Actions ─────────────────────────────────────────── */

function biensPublics_(u) {
  var masquer = u.role === 'menage';
  return biensAutorises_(u).map(function (b) {
    return {
      id: b.id, nom: b.nom, ville: b.ville, couleur: b.couleur || '#888', groupe_menage: b.groupe_menage,
      heure_arrivee: b.heure_arrivee || '16:00', heure_depart: b.heure_depart || '11:00',
      regle: masquer ? '' : libelleRegle_(b), a_ical: !!b.ical_urls
    };
  });
}

/** Retire ce qu'une personne n'a pas à voir (montants, téléphone…). */
function masquer_(u, r) {
  var o = {
    id: r.id, bien_id: r.bien_id, source: r.source, type: r.type, code: r.code, voyageur: r.voyageur,
    arrivee: r.arrivee, depart: r.depart, nuits: r.nuits, voyageurs: r.voyageurs, statut: r.statut, notes: r.notes
  };
  if (u.role !== 'menage') { o.montant = r.montant; o.montant_source = r.montant_source; o.tel4 = r.tel4; o.maj_le = r.maj_le; }
  return o;
}

function actInit_(u) {
  var p = params_();
  return {
    user: publicUser_(u), biens: biensPublics_(u), categories: CATEGORIES, roles: ROLES,
    params: { nom_app: p.nom_app, derniere_synchro: p.derniere_synchro, comptable: !!p.email_comptable, url_app: urlApp_() }
  };
}

function conflitsVisibles_(u, resas, depuis, jusqua) {
  var ids = idsAutorises_(u);
  return conflits_(resas, tousBiens_()).filter(function (c) {
    return (!depuis || c.date >= depuis) && (!jusqua || c.date <= jusqua) &&
           c.biens.some(function (b) { return ids.indexOf(b) >= 0; });
  });
}

function actTableau_(u) {
  var ids = idsAutorises_(u), auj = aujourdhui_(), fin = ajouterJours_(auj, 14);
  var resas = lire_('Reservations');
  var actives = resasActives_(resas).filter(function (r) { return ids.indexOf(r.bien_id) >= 0; });
  var evenements = [];
  actives.forEach(function (r) {
    if (r.arrivee >= auj && r.arrivee <= fin) evenements.push({ date: r.arrivee, type: 'arrivee', r: masquer_(u, r) });
    if (r.depart >= auj && r.depart <= fin) evenements.push({ date: r.depart, type: 'depart', r: masquer_(u, r) });
  });
  evenements.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : (a.type === 'depart' ? -1 : 1); });

  var enCours = actives.filter(function (r) { return r.arrivee <= auj && r.depart > auj; }).map(function (r) { return masquer_(u, r); });
  var out = {
    aujourdhui: auj, evenements: evenements, en_cours: enCours,
    conflits: conflitsVisibles_(u, resas, auj, null),
    derniere_synchro: params_().derniere_synchro
  };

  if (u.role !== 'menage') {
    var mois = auj.slice(0, 7);
    var sansMontant = actives.filter(function (r) { return r.arrivee <= auj && !r.montant && r.montant !== 0; }).length;
    var duMois = actives.filter(function (r) { return r.arrivee.slice(0, 7) === mois; });
    out.mois = {
      sejours: duMois.length,
      nuits: duMois.reduce(function (s, r) { return s + (Number(r.nuits) || 0); }, 0),
      brut: arrondi_(duMois.reduce(function (s, r) { return s + (Number(r.montant) || 0); }, 0))
    };
    out.sans_montant = sansMontant;
  }
  var docs = lire_('Documents');
  out.docs_a_envoyer = docs.filter(function (d) { return !d.envoye_le && (u.role === 'admin' || ids.indexOf(d.bien_id) >= 0 || d.ajoute_par === u.identifiant); }).length;
  var faits = {};
  lire_('Menages').forEach(function (m) { if (m.statut === 'fait') faits[m.reservation_id] = true; });
  out.menages_7j = actives.filter(function (r) { return r.depart >= auj && r.depart <= ajouterJours_(auj, 7) && !faits[r.id]; }).length;
  return out;
}

function actCalendrier_(u, p) {
  var ids = idsAutorises_(u);
  var debut = p.debut || ajouterJours_(aujourdhui_(), -31), fin = p.fin || ajouterJours_(aujourdhui_(), 62);
  var resas = lire_('Reservations');
  var liste = resas.filter(function (r) {
    return ids.indexOf(r.bien_id) >= 0 && r.statut !== 'annulée' && r.depart >= debut && r.arrivee <= fin;
  }).map(function (r) { return masquer_(u, r); });
  return { reservations: liste, conflits: conflitsVisibles_(u, resas, debut, fin) };
}

function actMenages_(u, p) {
  var ids = idsAutorises_(u), auj = aujourdhui_();
  var debut = p.debut || ajouterJours_(auj, -7), fin = p.fin || ajouterJours_(auj, 60);
  var biens = tousBiens_(), parId = {};
  biens.forEach(function (b) { parId[b.id] = b; });
  var resas = lire_('Reservations');
  var actives = resasActives_(resas);
  var statuts = {};
  lire_('Menages').forEach(function (m) { statuts[m.reservation_id] = m; });
  var conf = {}, confRes = {};
  conflits_(resas, biens).forEach(function (c) {
    if (c.type === 'menage') { confRes[c.reservations[0]] = c.message; return; }
    c.biens.forEach(function (b) { conf[b + '|' + c.date] = c.message; });
  });
  var jourMenage = planningMenage_(actives, biens).jours;

  var liste = [];
  actives.forEach(function (r) {
    if (ids.indexOf(r.bien_id) < 0 || r.depart < debut || r.depart > fin) return;
    // (le jour de ménage proposé peut être après le départ, jusqu'à l'arrivée suivante)
    var suivante = actives.filter(function (x) { return x.bien_id === r.bien_id && x.arrivee >= r.depart && x.id !== r.id; })
      .sort(function (a, b) { return a.arrivee < b.arrivee ? -1 : 1; })[0];
    var b = parId[r.bien_id] || {}, s = statuts[r.id] || {};
    liste.push({
      reservation_id: r.id, bien_id: r.bien_id, date: r.depart, heure_depart: b.heure_depart || '11:00',
      partants: r.voyageurs, nuits: r.nuits,
      suivante: suivante ? { arrivee: suivante.arrivee, heure: b.heure_arrivee || '16:00', voyageurs: suivante.voyageurs,
                             nuits: suivante.nuits, notes: suivante.notes, jour_meme: suivante.arrivee === r.depart } : null,
      statut: s.statut || 'à faire', fait_le: s.fait_le || '', fait_par: s.fait_par || '', note: s.note || '',
      jour_menage: jourMenage[r.id] || r.depart,
      conflit: confRes[r.id] || conf[r.bien_id + '|' + r.depart] || (suivante && conf[r.bien_id + '|' + suivante.arrivee]) || ''
    });
  });
  liste.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  return liste;
}

function actMenageStatut_(u, p) {
  var r = lire_('Reservations').filter(function (x) { return x.id === p.reservation_id; })[0];
  if (!r) throw new Error('Réservation introuvable.');
  verifierBien_(u, r.bien_id);
  var m = lire_('Menages').filter(function (x) { return x.reservation_id === r.id; })[0] ||
          { reservation_id: r.id, bien_id: r.bien_id, date: r.depart };
  if (p.statut) {
    m.statut = p.statut;
    m.fait_le = p.statut === 'fait' ? maintenant_() : '';
    m.fait_par = p.statut === 'fait' ? (u.nom || u.identifiant) : '';
  }
  if (p.note !== undefined) m.note = String(p.note).slice(0, 500);
  sauver_('Menages', m);
  journal_(u.identifiant, 'ménage', r.id + ' → ' + (m.statut || '') + (p.note ? ' (note)' : ''));
  return { statut: m.statut || 'à faire', fait_le: m.fait_le, fait_par: m.fait_par, note: m.note };
}

function actReservations_(u, p) {
  var ids = idsAutorises_(u), annee = String(p.annee || aujourdhui_().slice(0, 4));
  return lire_('Reservations').filter(function (r) {
    return ids.indexOf(r.bien_id) >= 0 && (r.arrivee.slice(0, 4) === annee || r.depart.slice(0, 4) === annee) &&
           (p.blocages || r.type !== 'blocage');
  }).map(function (r) { return masquer_(u, r); });
}

function actReservationSave_(u, p) {
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var r;
    if (p.id) {
      r = lire_('Reservations').filter(function (x) { return x.id === p.id; })[0];
      if (!r) throw new Error('Réservation introuvable.');
      verifierBien_(u, r.bien_id);
    } else {
      verifierBien_(u, p.bien_id);
      r = { id: 'M' + Utilities.getUuid().slice(0, 8), bien_id: p.bien_id, source: 'manuel', type: 'reservation',
            uid: '', code: '', tel4: '', statut: 'confirmée' };
    }
    if (r.source === 'manuel') {
      if (!estDate_(p.arrivee) || !estDate_(p.depart) || p.depart <= p.arrivee) throw new Error('Dates invalides.');
      if (p.bien_id) { verifierBien_(u, p.bien_id); r.bien_id = p.bien_id; }
      r.arrivee = p.arrivee; r.depart = p.depart; r.nuits = ecartJours_(p.arrivee, p.depart);
      if (p.code !== undefined) r.code = p.code;
    }
    ['voyageur', 'notes'].forEach(function (k) { if (p[k] !== undefined) r[k] = String(p[k]).slice(0, 500); });
    if (p.voyageurs !== undefined) r.voyageurs = p.voyageurs === '' ? '' : Number(p.voyageurs);
    if (p.montant !== undefined) {
      var mt = p.montant === '' ? '' : Number(String(p.montant).replace(',', '.'));
      if (mt !== r.montant) { r.montant = mt; r.montant_source = mt === '' ? '' : 'manuel'; }
    }
    if (p.statut && ['confirmée', 'annulée'].indexOf(p.statut) >= 0) r.statut = p.statut;
    r.maj_le = maintenant_();
    sauver_('Reservations', r);
    journal_(u.identifiant, p.id ? 'réservation modifiée' : 'réservation créée', r.id);
    return masquer_(u, r);
  } finally { lock.releaseLock(); }
}

function actReservationSuppr_(u, p) {
  var r = lire_('Reservations').filter(function (x) { return x.id === p.id; })[0];
  if (!r) throw new Error('Réservation introuvable.');
  verifierBien_(u, r.bien_id);
  if (r.source !== 'manuel') throw new Error('Une réservation Airbnb ne se supprime pas : elle disparaît toute seule si elle est annulée sur Airbnb.');
  supprimerLigne_('Reservations', r._row);
  journal_(u.identifiant, 'réservation supprimée', r.id);
  return true;
}

function actRevenus_(u, p) {
  var annee = Number(p.annee) || Number(aujourdhui_().slice(0, 4));
  var ids = idsAutorises_(u);
  var biens = tousBiens_().filter(function (b) { return ids.indexOf(b.id) >= 0; });
  var docs = lire_('Documents').filter(function (d) { return !d.bien_id ? u.role !== 'gestionnaire' : ids.indexOf(d.bien_id) >= 0; });
  return calculRevenus_(annee, biens, lire_('Reservations'), docs, p.mode || params_().repartition_revenus);
}

function docsVisibles_(u) {
  var ids = idsAutorises_(u);
  return lire_('Documents').filter(function (d) {
    if (u.role === 'admin' || u.role === 'comptable') return true;
    if (u.role === 'menage') return d.ajoute_par === u.identifiant;
    return d.ajoute_par === u.identifiant || (d.bien_id && ids.indexOf(d.bien_id) >= 0);
  });
}

function actDocuments_(u, p) {
  var annee = String(p.annee || aujourdhui_().slice(0, 4));
  return docsVisibles_(u).filter(function (d) { return d.date.slice(0, 4) === annee; })
    .sort(function (a, b) { return a.date < b.date ? 1 : -1; })
    .map(function (d) { var o = {}; SCHEMA.Documents.forEach(function (c) { o[c] = d[c]; }); return o; });
}

function actDocumentSave_(u, p) {
  var d = docsVisibles_(u).filter(function (x) { return x.id === p.id; })[0];
  if (!d) throw new Error('Justificatif introuvable.');
  if (u.role === 'comptable') throw new Error('Lecture seule.');
  if (p.bien_id) verifierBien_(u, p.bien_id);
  ['date', 'bien_id', 'type', 'categorie', 'fournisseur', 'imputation', 'description'].forEach(function (k) {
    if (p[k] !== undefined) d[k] = String(p[k]);
  });
  if (p.montant !== undefined) d.montant = p.montant === '' ? '' : Number(String(p.montant).replace(',', '.'));
  sauver_('Documents', d);
  return true;
}

function actDocumentSuppr_(u, p) {
  var d = docsVisibles_(u).filter(function (x) { return x.id === p.id; })[0];
  if (!d) throw new Error('Justificatif introuvable.');
  if (u.role !== 'admin' && d.ajoute_par !== u.identifiant) throw new Error('Seule la personne qui l\'a ajouté peut le supprimer.');
  if (d.envoye_le && u.role !== 'admin') throw new Error('Déjà envoyé au comptable : seul un administrateur peut le supprimer.');
  try { DriveApp.getFileById(d.fichier_id).setTrashed(true); } catch (e) { /* déjà supprimé */ }
  supprimerLigne_('Documents', d._row);
  journal_(u.identifiant, 'justificatif supprimé', d.id);
  return true;
}

/* ── Réglages (admin) ───────────────────────────────── */

function actReglages_() {
  var p = params_();
  return {
    biens: lire_('Biens').map(function (b) { delete b._row; return b; }),
    utilisateurs: lire_('Utilisateurs').map(publicUser_),
    parametres: PARAMS_DEFAUT.filter(function (x) { return PARAMS_INTERNES.indexOf(x[0]) < 0; })
      .map(function (x) { return { cle: x[0], valeur: p[x[0]], description: x[2] }; }),
    liens: { base: ss_().getUrl(), dossier: p.dossier_id ? 'https://drive.google.com/drive/folders/' + p.dossier_id : '' }
  };
}

function actBienSave_(u, p) {
  var id = String(p.id || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
  if (!id) throw new Error('Identifiant du bien obligatoire (ex. TILH1).');
  var b = lire_('Biens').filter(function (x) { return x.id === id; })[0] || { id: id };
  if (p.nouveau && b._row) throw new Error('Un bien avec cet identifiant existe déjà.');
  ['nom', 'ville', 'groupe_menage', 'ical_urls', 'couleur', 'regle_type', 'regle_base', 'proprietaire',
   'heure_arrivee', 'heure_depart', 'actif'].forEach(function (k) { if (p[k] !== undefined) b[k] = String(p[k]).trim(); });
  b.groupe_menage = String(b.groupe_menage || '').toUpperCase();
  b.regle_valeur = Number(String(p.regle_valeur || 0).replace(',', '.')) || 0;
  if (!b.nom) throw new Error('Nom du bien obligatoire.');
  sauver_('Biens', b);
  journal_(u.identifiant, 'bien enregistré', id);
  return true;
}

function actUtilisateurSave_(u, p) {
  var ident = String(p.identifiant || '').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');
  if (!ident) throw new Error('Identifiant obligatoire.');
  if (!ROLES[p.role]) throw new Error('Rôle invalide.');
  var x = lire_('Utilisateurs').filter(function (y) { return y.identifiant === ident; })[0];
  if (p.nouveau && x) throw new Error('Cet identifiant existe déjà.');
  x = x || { identifiant: ident, cree_le: maintenant_() };
  if (x.identifiant === u.identifiant && (p.role !== 'admin' || p.actif === 'non')) {
    throw new Error('Vous ne pouvez pas retirer vos propres droits administrateur.');
  }
  x.nom = String(p.nom || '').trim(); x.email = String(p.email || '').trim();
  x.role = p.role; x.biens = String(p.biens || '').trim(); x.actif = p.actif === 'non' ? 'non' : 'oui';
  var mdp = null;
  if (p.nouveau || p.reinit) {
    mdp = p.mdp && String(p.mdp).length >= 6 ? String(p.mdp) : aleatoire_(10);
    definirMdp_(x, mdp);
  }
  sauver_('Utilisateurs', x);
  journal_(u.identifiant, 'utilisateur enregistré', ident + (mdp ? ' (mot de passe défini)' : ''));
  return { mdp: mdp };
}

function actParametresSave_(u, p) {
  var autorises = PARAMS_DEFAUT.map(function (x) { return x[0]; }).filter(function (k) { return PARAMS_INTERNES.indexOf(k) < 0; });
  Object.keys(p || {}).forEach(function (k) { if (autorises.indexOf(k) >= 0) setParam_(k, String(p[k]).trim()); });
  journal_(u.identifiant, 'paramètres', Object.keys(p).join(', '));
  return true;
}

function actMonMdp_(u, p) {
  var x = lire_('Utilisateurs').filter(function (y) { return y.identifiant === u.identifiant; })[0];
  if (hashMdp_(String(p.ancien || ''), x.sel) !== x.hash) throw new Error('Mot de passe actuel incorrect.');
  definirMdp_(x, p.nouveau);
  sauver_('Utilisateurs', x);
  journal_(u.identifiant, 'mot de passe changé', '');
  return true;
}
