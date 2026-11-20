/**
 * Finances.gs — Calcul des revenus (règles de partage par bien) et justificatifs (tickets, factures).
 */

/* ── Règles de partage ───────────────────────────────────
 * regle_type :
 *   'seuil'        → le propriétaire touche jusqu'à X €, le reste est pour moi (ex. Thiel : 600 €)
 *   'pourcentage'  → je touche X % du montant, le reste va au propriétaire
 *   'total'        → 100 % pour moi
 *   'proprietaire' → 100 % pour le propriétaire
 * regle_base (pour 'seuil') : 'mois' (seuil par mois), 'reservation' (par séjour) ou 'annee'
 */

function partage_(montant, regle) {
  var m = Number(montant) || 0, v = Number(regle.valeur) || 0;
  switch (regle.type) {
    case 'seuil': var p = Math.min(m, v); return { proprio: p, moi: m - p };
    case 'pourcentage': var moi = m * v / 100; return { proprio: m - moi, moi: moi };
    case 'proprietaire': return { proprio: m, moi: 0 };
    default: return { proprio: 0, moi: m };
  }
}

function libelleRegle_(b) {
  var v = Number(b.regle_valeur) || 0;
  var base = { mois: 'par mois', reservation: 'par séjour', annee: 'par an' }[b.regle_base || 'mois'];
  switch (b.regle_type) {
    case 'seuil': return 'Jusqu\'à ' + v + ' € ' + base + ' pour ' + (b.proprietaire || 'le propriétaire') + ', le reste pour moi';
    case 'pourcentage': return v + ' % pour moi, le reste pour ' + (b.proprietaire || 'le propriétaire');
    case 'proprietaire': return '100 % pour ' + (b.proprietaire || 'le propriétaire');
    default: return '100 % pour moi';
  }
}

/** Répartit une réservation sur les mois de l'année : {indexMois: {frac, nuits}}. */
function allocation_(r, annee, mode) {
  var out = {};
  var nuits = Number(r.nuits) || ecartJours_(r.arrivee, r.depart);
  if (mode === 'nuits' && nuits > 0) {
    for (var i = 0; i < nuits; i++) {
      var d = ajouterJours_(r.arrivee, i);
      if (Number(d.slice(0, 4)) !== annee) continue;
      var k = Number(d.slice(5, 7)) - 1;
      out[k] = out[k] || { frac: 0, nuits: 0 };
      out[k].frac += 1 / nuits; out[k].nuits += 1;
    }
  } else if (Number(String(r.arrivee).slice(0, 4)) === annee) {
    out[Number(r.arrivee.slice(5, 7)) - 1] = { frac: 1, nuits: nuits };
  }
  return out;
}

function arrondi_(n) { return Math.round((Number(n) || 0) * 100) / 100; }

function calculRevenus_(annee, biens, resas, docs, mode) {
  var vide = function () { return { brut: 0, proprio: 0, moi: 0, dep_moi: 0, dep_proprio: 0, nuits: 0, sejours: 0, sans_montant: 0 }; };
  var total = vide();

  var lignes = biens.map(function (b) {
    var regle = { type: b.regle_type || 'total', valeur: b.regle_valeur, base: b.regle_base || 'mois' };
    var mois = [];
    for (var i = 0; i < 12; i++) mois.push(vide());

    resasActives_(resas).forEach(function (r) {
      if (r.bien_id !== b.id) return;
      var alloc = allocation_(r, annee, mode);
      var m = Number(r.montant) || 0;
      var sejour = regle.base === 'reservation' ? partage_(m, regle) : null;
      Object.keys(alloc).forEach(function (k) {
        var a = alloc[k], mo = mois[k];
        mo.brut += m * a.frac; mo.nuits += a.nuits;
        if (sejour) { mo.proprio += sejour.proprio * a.frac; mo.moi += sejour.moi * a.frac; }
      });
      if (Number(String(r.arrivee).slice(0, 4)) === annee) {
        var km = Number(r.arrivee.slice(5, 7)) - 1;
        mois[km].sejours++;
        if (r.montant === '' || r.montant === null) mois[km].sans_montant++;
      }
    });

    if (regle.type !== 'seuil' || regle.base === 'mois') {
      mois.forEach(function (mo) { var s = partage_(mo.brut, regle); mo.proprio = s.proprio; mo.moi = s.moi; });
    } else if (regle.base === 'annee') {
      var reste = Number(regle.valeur) || 0;
      mois.forEach(function (mo) {
        var p = Math.min(mo.brut, Math.max(reste, 0)); reste -= p;
        mo.proprio = p; mo.moi = mo.brut - p;
      });
    }

    docs.forEach(function (d) {
      if (d.bien_id !== b.id || Number(String(d.date).slice(0, 4)) !== annee) return;
      var k = Number(d.date.slice(5, 7)) - 1, m = Number(d.montant) || 0;
      if (d.imputation === 'proprietaire') mois[k].dep_proprio += m;
      else if (d.imputation === 'partage') { mois[k].dep_moi += m / 2; mois[k].dep_proprio += m / 2; }
      else mois[k].dep_moi += m;
    });

    var tb = vide();
    mois.forEach(function (mo) {
      Object.keys(mo).forEach(function (k) { mo[k] = arrondi_(mo[k]); tb[k] += mo[k]; });
      mo.net_moi = arrondi_(mo.moi - mo.dep_moi);
      mo.net_proprio = arrondi_(mo.proprio - mo.dep_proprio);
    });
    Object.keys(tb).forEach(function (k) { tb[k] = arrondi_(tb[k]); total[k] += tb[k]; });
    tb.net_moi = arrondi_(tb.moi - tb.dep_moi);
    tb.net_proprio = arrondi_(tb.proprio - tb.dep_proprio);

    return { id: b.id, nom: b.nom, couleur: b.couleur, proprietaire: b.proprietaire, regle: libelleRegle_(b), mois: mois, total: tb };
  });

  // Dépenses générales (sans bien)
  var gen = 0;
  docs.forEach(function (d) {
    if (!d.bien_id && Number(String(d.date).slice(0, 4)) === annee && d.imputation !== 'proprietaire') gen += Number(d.montant) || 0;
  });
  total.dep_generales = arrondi_(gen);
  Object.keys(total).forEach(function (k) { total[k] = arrondi_(total[k]); });
  total.net_moi = arrondi_(total.moi - total.dep_moi - gen);
  return { annee: annee, mode: mode, biens: lignes, total: total };
}

/* ── Justificatifs ─────────────────────────────────────── */

var CATEGORIES = ['Produits ménage', 'Linge / blanchisserie', 'Entretien / réparations', 'Équipement / mobilier',
                  'Consommables (café, papier…)', 'Énergie / eau', 'Internet / téléphone', 'Assurance',
                  'Taxes / impôts', 'Frais de plateforme', 'Prestation ménage', 'Déplacement', 'Autre'];

function dossierRacine_() {
  var p = params_();
  if (p.dossier_id) {
    try { return DriveApp.getFolderById(p.dossier_id); } catch (e) { /* recréé ci-dessous */ }
  }
  var f = DriveApp.createFolder((p.nom_app || 'Locations') + ' — Justificatifs');
  setParam_('dossier_id', f.getId());
  return f;
}

function sousDossier_(parent, nom) {
  var it = parent.getFoldersByName(nom);
  return it.hasNext() ? it.next() : parent.createFolder(nom);
}

function nettoyerNom_(s) {
  return String(s || '').replace(/[^\wÀ-ÿ€ .-]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
}

function televerserDocument_(u, d) {
  if (!d.data) throw new Error('Aucun fichier reçu.');
  if (d.bien_id) verifierBien_(u, d.bien_id);
  var date = estDate_(d.date) ? d.date : aujourdhui_();
  var mime = d.mime || 'image/jpeg';
  var ext = mime === 'application/pdf' ? 'pdf' : (mime === 'image/png' ? 'png' : 'jpg');
  var nom = [date, d.bien_id || 'GENERAL', nettoyerNom_(d.categorie), nettoyerNom_(d.fournisseur),
             d.montant ? String(d.montant).replace('.', ',') + '€' : ''].filter(String).join('_') + '.' + ext;
  var blob = Utilities.newBlob(Utilities.base64Decode(d.data), mime, nom);
  var dossier = sousDossier_(sousDossier_(dossierRacine_(), date.slice(0, 4)), date.slice(0, 7));
  var f = dossier.createFile(blob);
  var doc = {
    id: 'D' + Utilities.getUuid().slice(0, 8), date: date, bien_id: d.bien_id || '', type: d.type || 'ticket',
    categorie: d.categorie || 'Autre', fournisseur: d.fournisseur || '', montant: d.montant === '' ? '' : Number(d.montant) || '',
    imputation: d.imputation || 'moi', description: d.description || '', fichier_id: f.getId(), fichier_url: f.getUrl(),
    ajoute_par: u.identifiant, ajoute_le: maintenant_(), envoye_le: ''
  };
  sauver_('Documents', doc);
  journal_(u.identifiant, 'justificatif ajouté', doc.id + ' ' + nom);
  return doc;
}

function envoyerComptable_(u, ids) {
  var p = params_();
  var dest = String(p.email_comptable || '').trim();
  if (!dest) throw new Error('Renseignez l\'adresse du comptable dans Réglages → Paramètres.');
  var docs = lire_('Documents').filter(function (d) { return ids.indexOf(d.id) >= 0; });
  if (!docs.length) throw new Error('Aucun justificatif sélectionné.');
  var biens = {};
  tousBiens_().forEach(function (b) { biens[b.id] = b.nom; });

  // Lots de 18 Mo max (limite Gmail : 25 Mo)
  var lots = [[]], taille = 0;
  docs.forEach(function (d) {
    var blob;
    try { blob = DriveApp.getFileById(d.fichier_id).getBlob(); } catch (e) { return; }
    var t = blob.getBytes().length;
    if (taille + t > 18 * 1024 * 1024 && lots[lots.length - 1].length) { lots.push([]); taille = 0; }
    lots[lots.length - 1].push({ d: d, blob: blob });
    taille += t;
  });

  var csv = 'Date;Bien;Type;Catégorie;Fournisseur;Montant TTC;Imputation;Description;Fichier\n' + docs.map(function (d) {
    return [fr_(d.date), biens[d.bien_id] || 'Général', d.type, d.categorie, d.fournisseur,
            String(d.montant).replace('.', ','), d.imputation, d.description, d.fichier_url]
      .map(function (v) { return '"' + String(v || '').replace(/"/g, '""') + '"'; }).join(';');
  }).join('\n');
  var totalTTC = docs.reduce(function (s, d) { return s + (Number(d.montant) || 0); }, 0);

  lots.forEach(function (lot, i) {
    var att = lot.map(function (x) { return x.blob; });
    if (i === 0) att.push(Utilities.newBlob('﻿' + csv, 'text/csv', 'recapitulatif_justificatifs.csv'));
    var corps = 'Bonjour,\n\nVeuillez trouver ci-joint ' + docs.length + ' justificatif(s) — total ' +
      totalTTC.toFixed(2).replace('.', ',') + ' € TTC' + (lots.length > 1 ? ' (envoi ' + (i + 1) + '/' + lots.length + ')' : '') + '.\n\n' +
      lot.map(function (x) {
        return '• ' + fr_(x.d.date) + ' — ' + (biens[x.d.bien_id] || 'Général') + ' — ' + x.d.categorie +
               (x.d.fournisseur ? ' — ' + x.d.fournisseur : '') + (x.d.montant !== '' ? ' — ' + String(x.d.montant).replace('.', ',') + ' €' : '');
      }).join('\n') + '\n\nRécapitulatif au format tableur en pièce jointe.\n\nCordialement,\n' + (u.nom || '');
    MailApp.sendEmail(dest, (p.nom_app || 'Locations') + ' — justificatifs' + (lots.length > 1 ? ' (' + (i + 1) + '/' + lots.length + ')' : ''),
      corps, { attachments: att, name: u.nom || undefined, replyTo: u.email || undefined });
  });

  var tous = lire_('Documents'), quand = maintenant_();
  tous.forEach(function (d) { if (ids.indexOf(d.id) >= 0) { d.envoye_le = quand; sauver_('Documents', d); } });
  journal_(u.identifiant, 'envoi comptable', docs.length + ' justificatif(s) à ' + dest);
  return { envoyes: docs.length, emails: lots.length };
}
