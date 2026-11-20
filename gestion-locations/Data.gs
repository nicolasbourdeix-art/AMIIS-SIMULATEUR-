/**
 * Data.gs — Accès à la Google Sheet qui sert de base de données.
 * Chaque onglet = une table. La première ligne contient les en-têtes.
 */

var TZ = 'Europe/Paris';

var SCHEMA = {
  Biens: ['id', 'nom', 'ville', 'groupe_menage', 'ical_urls', 'couleur', 'regle_type', 'regle_valeur',
          'regle_base', 'proprietaire', 'heure_arrivee', 'heure_depart', 'actif'],
  Utilisateurs: ['identifiant', 'nom', 'email', 'role', 'biens', 'hash', 'sel', 'actif', 'cree_le', 'derniere_connexion'],
  Reservations: ['id', 'bien_id', 'source', 'type', 'uid', 'code', 'voyageur', 'arrivee', 'depart', 'nuits',
                 'voyageurs', 'montant', 'statut', 'notes', 'tel4', 'maj_le'],
  Menages: ['reservation_id', 'bien_id', 'date', 'statut', 'fait_le', 'fait_par', 'note'],
  Documents: ['id', 'date', 'bien_id', 'type', 'categorie', 'fournisseur', 'montant', 'imputation', 'description',
              'fichier_id', 'fichier_url', 'ajoute_par', 'ajoute_le', 'envoye_le'],
  Parametres: ['cle', 'valeur', 'description'],
  Journal: ['date', 'utilisateur', 'action', 'details']
};

/** Colonnes numériques (les autres sont stockées en texte brut pour éviter les conversions de Sheets). */
var NUMERIQUES = {
  Biens: ['regle_valeur'],
  Reservations: ['nuits', 'voyageurs', 'montant'],
  Documents: ['montant']
};

var _ssCache = null;

function ss_() {
  if (_ssCache) return _ssCache;
  var id = PropertiesService.getScriptProperties().getProperty('SS_ID');
  if (!id) throw new Error("Application non installée : lancez la fonction installer() depuis l'éditeur Apps Script.");
  _ssCache = SpreadsheetApp.openById(id);
  return _ssCache;
}

function sh_(nom) {
  var s = ss_().getSheetByName(nom);
  if (!s) throw new Error('Onglet manquant : ' + nom + ' (relancez installer()).');
  return s;
}

function formats_(nom) {
  var num = NUMERIQUES[nom] || [];
  return SCHEMA[nom].map(function (c) { return num.indexOf(c) >= 0 ? 'General' : '@'; });
}

function norm_(v, estNum) {
  if (v instanceof Date) {
    var avecHeure = v.getHours() || v.getMinutes();
    return Utilities.formatDate(v, TZ, avecHeure ? 'yyyy-MM-dd HH:mm' : 'yyyy-MM-dd');
  }
  if (estNum) return (v === '' || v === null) ? '' : Number(v);
  return v === null || v === undefined ? '' : String(v);
}

/** Lit un onglet complet → tableau d'objets {colonne: valeur, _row: n° de ligne}. */
function lire_(nom) {
  var s = sh_(nom), cols = SCHEMA[nom], last = s.getLastRow();
  if (last < 2) return [];
  var num = NUMERIQUES[nom] || [];
  var vals = s.getRange(2, 1, last - 1, cols.length).getValues();
  var out = [];
  for (var i = 0; i < vals.length; i++) {
    var o = { _row: i + 2 };
    for (var j = 0; j < cols.length; j++) o[cols[j]] = norm_(vals[i][j], num.indexOf(cols[j]) >= 0);
    if (o[cols[0]] !== '') out.push(o);
  }
  return out;
}

function ligne_(nom, obj) {
  return SCHEMA[nom].map(function (c) {
    var v = obj[c];
    return (v === undefined || v === null) ? '' : v;
  });
}

/** Crée (sans _row) ou met à jour (avec _row) une ligne. */
function sauver_(nom, obj) {
  var s = sh_(nom), n = SCHEMA[nom].length;
  var row = obj._row || (s.getLastRow() + 1);
  var r = s.getRange(row, 1, 1, n);
  r.setNumberFormats([formats_(nom)]);
  r.setValues([ligne_(nom, obj)]);
  obj._row = row;
  return obj;
}

/** Réécrit toutes les lignes d'un onglet (utilisé par la synchro, en un seul appel). */
function ecrireTout_(nom, objets) {
  var s = sh_(nom), n = SCHEMA[nom].length, last = s.getLastRow();
  if (last >= 2) s.getRange(2, 1, last - 1, n).clearContent();
  if (!objets.length) return;
  var r = s.getRange(2, 1, objets.length, n);
  var f = formats_(nom);
  r.setNumberFormats(objets.map(function () { return f; }));
  r.setValues(objets.map(function (o) { return ligne_(nom, o); }));
}

function supprimerLigne_(nom, row) {
  if (row && row >= 2) sh_(nom).deleteRow(row);
}

function maintenant_() {
  return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm');
}

function aujourdhui_() {
  return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
}

function journal_(qui, action, details) {
  try {
    sauver_('Journal', { date: maintenant_(), utilisateur: qui, action: action, details: details || '' });
  } catch (e) { /* le journal ne doit jamais bloquer une action */ }
}

/* ── Paramètres ─────────────────────────────────────────── */

var PARAMS_DEFAUT = [
  ['nom_app', 'Mes Locations', "Nom affiché en haut de l'application"],
  ['email_alertes', '', 'Adresse qui reçoit les alertes de conflit (séparer par des virgules)'],
  ['email_comptable', '', 'Adresse du comptable pour l\'envoi des justificatifs'],
  ['regle_2_departs', 'oui', 'Alerte si 2 départs le même jour dans un même groupe de ménage'],
  ['regle_2_arrivees', 'oui', 'Alerte si 2 arrivées le même jour dans un même groupe de ménage'],
  ['ignorer_blocages', 'oui', 'Ignorer les dates simplement bloquées (« Not available ») dans Airbnb'],
  ['repartition_revenus', 'arrivee', '« arrivee » = revenu compté le mois d\'arrivée, « nuits » = réparti au prorata des nuits'],
  ['rappel_menage', 'oui', 'Envoyer chaque soir à 18h le programme du lendemain aux personnes « Ménage »'],
  ['dossier_id', '', 'Dossier Google Drive des justificatifs (rempli automatiquement)'],
  ['derniere_synchro', '', 'Date de la dernière synchronisation Airbnb (automatique)']
];

function params_() {
  var o = {};
  PARAMS_DEFAUT.forEach(function (p) { o[p[0]] = p[1]; });
  lire_('Parametres').forEach(function (p) { o[p.cle] = p.valeur; });
  return o;
}

function setParam_(cle, valeur) {
  var lignes = lire_('Parametres');
  for (var i = 0; i < lignes.length; i++) {
    if (lignes[i].cle === cle) { lignes[i].valeur = valeur; sauver_('Parametres', lignes[i]); return; }
  }
  var desc = '';
  PARAMS_DEFAUT.forEach(function (p) { if (p[0] === cle) desc = p[2]; });
  sauver_('Parametres', { cle: cle, valeur: valeur, description: desc });
}

/* ── Dates (chaînes 'yyyy-MM-dd') ───────────────────────── */

function jourUTC_(s) {
  var p = String(s).split('-');
  return Date.UTC(+p[0], +p[1] - 1, +p[2]);
}

function ajouterJours_(s, n) {
  var d = new Date(jourUTC_(s) + n * 86400000);
  return d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + d.getUTCDate()).slice(-2);
}

function ecartJours_(a, b) {
  return Math.round((jourUTC_(b) - jourUTC_(a)) / 86400000);
}

function estDate_(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
}
