/**
 * Emails.gs — Récupération automatique des montants depuis les emails Airbnb (Gmail).
 *
 * Airbnb envoie à l'hôte un email « Réservation confirmée : X arrive le … » qui contient :
 *   CODE DE CONFIRMATION  HMXXXXXXXX
 *   VOYAGEURS             2 adultes, 1 enfant
 *   VOUS GAGNEZ           347,04 €        (montant net versé à l'hôte)
 * Le code est le même que dans le calendrier iCal : on retrouve donc la réservation et on
 * remplit son montant, le nombre de voyageurs et le nom.
 *
 * Le script lit la boîte Gmail du compte qui a déployé l'application (lecture seule).
 * Les emails transférés (ex. Xavier qui transfère ceux de Soustons) sont acceptés si leur
 * expéditeur figure dans le paramètre « emails_transfert ».
 */

var REQUETE_GMAIL = 'subject:("Réservation confirmée" OR "Reservation confirmed" OR "Réservation modifiée" OR "Reservation altered" OR "Modification de réservation") ' +
                    '("vous gagnez" OR "you earn") newer_than:400d';

/** Convertit « 1 234,56 », « 1,234.56 », « 347,04 » → nombre. */
function nombreEmail_(s) {
  s = String(s || '').replace(/[\s  €$£]/g, '');
  if (!s) return NaN;
  var dec = s.match(/[.,](\d{1,2})$/);
  if (dec) {
    var entier = s.slice(0, s.length - dec[0].length).replace(/[.,]/g, '');
    return Number(entier + '.' + dec[1]);
  }
  return Number(s.replace(/[.,]/g, ''));
}

/** Analyse un email Airbnb. Renvoie null si ce n'est pas un email exploitable. */
function parserEmailAirbnb_(sujet, corps) {
  var t = String(corps || '').replace(/\r/g, '');
  var code = (t.match(/CODE DE CONFIRMATION\s*\n?\s*(HM[A-Z0-9]{6,})/i) ||
              t.match(/CONFIRMATION CODE\s*\n?\s*(HM[A-Z0-9]{6,})/i) ||
              t.match(/reservations\/details\/(HM[A-Z0-9]{6,})/i) || [])[1];
  var gain = t.match(/VOUS GAGNEZ\s*:?\s*([-−]?[\d\s  .,]+)\s*€/i) ||
             t.match(/YOU EARN\s*:?\s*€\s*([\d\s,.]+)/i) ||
             t.match(/YOU EARN\s*:?\s*([\d\s,.]+)\s*€/i);
  if (!code || !gain) return null;
  var montant = nombreEmail_(gain[1].replace('−', '-'));
  if (isNaN(montant)) return null;

  var nb = function (re) { var m = t.match(re); return m ? Number(m[1]) : 0; };
  var adultes = nb(/(\d+)\s*adultes?/i) || nb(/(\d+)\s*adults?/i);
  var enfants = nb(/(\d+)\s*enfants?/i) || nb(/(\d+)\s*child(?:ren)?/i);
  var bebes = nb(/(\d+)\s*bébés?/i) || nb(/(\d+)\s*infants?/i);
  var nom = (String(sujet || '').match(/(?:confirmée|confirmed)\s*:\s*(.+?)\s+(?:arrive|arrives)\b/i) || [])[1] || '';

  return {
    code: code.toUpperCase(),
    montant: Math.round(montant * 100) / 100,
    voyageurs: adultes + enfants || '',
    bebes: bebes,
    voyageur: nom.trim()
  };
}

function expediteurAutorise_(from, p) {
  var adr = (String(from).match(/<([^>]+)>/) || [null, from])[1].toLowerCase().trim();
  if (/@airbnb\.(com|fr|[a-z.]+)$/.test(adr)) return true;
  return String(p.emails_transfert || '').toLowerCase().split(/[\s,;]+/).filter(String).indexOf(adr) >= 0;
}

/**
 * Lit les nouveaux emails Airbnb, les mémorise dans l'onglet EmailsAirbnb,
 * puis complète les réservations correspondantes.
 */
function importerMontantsEmails_(forcer) {
  var p = params_();
  if (p.import_emails === 'non' && !forcer) return { lus: 0, appliques: 0, desactive: true };
  var deja = {};
  var memo = lire_('EmailsAirbnb');
  memo.forEach(function (m) { deja[m.message_id] = true; });

  var nouveaux = 0, ignores = 0;
  var threads = GmailApp.search(REQUETE_GMAIL, 0, 100);
  threads.forEach(function (th) {
    th.getMessages().forEach(function (msg) {
      var id = msg.getId();
      if (deja[id]) return;
      deja[id] = true;
      if (!expediteurAutorise_(msg.getFrom(), p)) { ignores++; return; }
      var info = parserEmailAirbnb_(msg.getSubject(), msg.getPlainBody());
      if (!info) return;
      var ligne = {
        message_id: id, recu_le: Utilities.formatDate(msg.getDate(), TZ, 'yyyy-MM-dd HH:mm'),
        code: info.code, montant: info.montant, voyageurs: info.voyageurs, bebes: info.bebes,
        voyageur: info.voyageur, sujet: String(msg.getSubject()).slice(0, 200), applique_le: ''
      };
      sauver_('EmailsAirbnb', ligne);
      memo.push(ligne);
      nouveaux++;
    });
  });

  var appliques = appliquerMontantsEmails_(memo);
  return { lus: nouveaux, appliques: appliques, ignores: ignores };
}

/** Reporte les montants mémorisés sur les réservations (le dernier email reçu fait foi). */
function appliquerMontantsEmails_(memo) {
  var parCode = {};
  memo.forEach(function (m) {
    if (!m.code) return;
    if (!parCode[m.code] || m.recu_le > parCode[m.code].recu_le) parCode[m.code] = m;
  });
  var resas = lire_('Reservations'), n = 0;
  resas.forEach(function (r) {
    var m = r.code && parCode[r.code];
    if (!m) return;
    // Un montant saisi à la main n'est jamais écrasé
    if (r.montant_source === 'manuel' && r.montant !== '') return;
    var change = false;
    if (r.montant !== m.montant) { r.montant = m.montant; change = true; }
    if (r.montant_source !== 'email') { r.montant_source = 'email'; change = true; }
    if (r.voyageurs === '' && m.voyageurs !== '') { r.voyageurs = m.voyageurs; change = true; }
    if (!r.voyageur && m.voyageur) { r.voyageur = m.voyageur; change = true; }
    if (Number(m.bebes) > 0 && String(r.notes).indexOf('bébé') < 0) {
      r.notes = (r.notes ? r.notes + ' · ' : '') + m.bebes + ' bébé(s) : prévoir lit parapluie';
      change = true;
    }
    if (change) { r.maj_le = maintenant_(); sauver_('Reservations', r); n++; }
  });
  if (n) {
    var quand = maintenant_();
    lire_('EmailsAirbnb').forEach(function (m) {
      if (!m.applique_le && resas.some(function (r) { return r.code === m.code; })) { m.applique_le = quand; sauver_('EmailsAirbnb', m); }
    });
  }
  return n;
}
