/**
 * Auth.gs — Connexion par identifiant + mot de passe (indépendant des comptes Google,
 * pour que Laetitia ou Xavier puissent se connecter depuis n'importe quel téléphone).
 */

var ROLES = {
  admin: 'Administrateur',      // tout voir, tout régler
  gestionnaire: 'Gestionnaire', // ses biens : réservations, revenus, ménages, justificatifs
  menage: 'Ménage',             // planning des ménages et calendrier de ses biens, sans les montants
  comptable: 'Comptable'        // revenus et justificatifs, en lecture
};

var DUREE_SESSION_JOURS = 30;

function hex_(bytes) {
  return bytes.map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join('');
}

function sha_(txt) {
  return hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, txt, Utilities.Charset.UTF_8));
}

function hashMdp_(mdp, sel) {
  var v = sel + '|' + mdp;
  for (var i = 0; i < 500; i++) v = sha_(v + sel);
  return v;
}

function aleatoire_(n) {
  var alpha = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var s = '';
  var src = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  for (var i = 0; i < n; i++) s += alpha.charAt(parseInt(src.substr(i * 2, 2), 16) % alpha.length);
  return s;
}

function definirMdp_(u, mdp) {
  if (!mdp || String(mdp).length < 6) throw new Error('Le mot de passe doit faire au moins 6 caractères.');
  u.sel = aleatoire_(16);
  u.hash = hashMdp_(String(mdp), u.sel);
}

/** Appelée par l'écran de connexion. */
function connexion(identifiant, mdp) {
  try {
    identifiant = String(identifiant || '').trim().toLowerCase();
    var cache = CacheService.getScriptCache();
    var cleEchec = 'echec_' + identifiant;
    var echecs = Number(cache.get(cleEchec) || 0);
    if (echecs >= 5) throw new Error('Trop de tentatives. Réessayez dans 15 minutes.');

    var u = lire_('Utilisateurs').filter(function (x) {
      return x.identifiant.toLowerCase() === identifiant && x.actif !== 'non';
    })[0];
    if (!u || !u.hash || hashMdp_(String(mdp || ''), u.sel) !== u.hash) {
      cache.put(cleEchec, String(echecs + 1), 900);
      throw new Error('Identifiant ou mot de passe incorrect.');
    }
    cache.remove(cleEchec);

    var token = Utilities.getUuid().replace(/-/g, '') + aleatoire_(16);
    var props = PropertiesService.getScriptProperties();
    props.setProperty('S_' + sha_(token), JSON.stringify({
      u: u.identifiant, exp: Date.now() + DUREE_SESSION_JOURS * 86400000
    }));
    nettoyerSessions_();

    u.derniere_connexion = maintenant_();
    sauver_('Utilisateurs', u);
    journal_(u.identifiant, 'connexion', '');
    return { ok: true, data: { token: token } };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function deconnexion_(token) {
  if (token) PropertiesService.getScriptProperties().deleteProperty('S_' + sha_(token));
}

function nettoyerSessions_() {
  var props = PropertiesService.getScriptProperties(), all = props.getProperties(), now = Date.now();
  Object.keys(all).forEach(function (k) {
    if (k.indexOf('S_') !== 0) return;
    try { if (JSON.parse(all[k]).exp < now) props.deleteProperty(k); } catch (e) { props.deleteProperty(k); }
  });
}

/** Retrouve l'utilisateur d'un jeton, ou lève une erreur « auth ». */
function utilisateur_(token) {
  var err = new Error('Session expirée, merci de vous reconnecter.');
  err.auth = true;
  if (!token) throw err;
  var cle = 'S_' + sha_(token);
  var raw = PropertiesService.getScriptProperties().getProperty(cle);
  if (!raw) throw err;
  var s = JSON.parse(raw);
  if (s.exp < Date.now()) { PropertiesService.getScriptProperties().deleteProperty(cle); throw err; }
  var u = lire_('Utilisateurs').filter(function (x) { return x.identifiant === s.u && x.actif !== 'non'; })[0];
  if (!u) throw err;
  u.listeBiens = String(u.biens || '').split(',').map(function (b) { return b.trim(); }).filter(String);
  u.token = token;
  return u;
}

function publicUser_(u) {
  return {
    identifiant: u.identifiant, nom: u.nom, email: u.email, role: u.role,
    role_label: ROLES[u.role] || u.role, biens: u.biens, actif: u.actif || 'oui',
    cree_le: u.cree_le, derniere_connexion: u.derniere_connexion
  };
}

/* ── Droits ─────────────────────────────────────────────── */

function tousBiens_() {
  return lire_('Biens').filter(function (b) { return b.actif !== 'non'; });
}

function biensAutorises_(u) {
  var tous = tousBiens_();
  if (u.role === 'admin' || u.role === 'comptable' || u.listeBiens.indexOf('*') >= 0) return tous;
  return tous.filter(function (b) { return u.listeBiens.indexOf(b.id) >= 0; });
}

function idsAutorises_(u) {
  return biensAutorises_(u).map(function (b) { return b.id; });
}

function verifierBien_(u, bienId) {
  if (idsAutorises_(u).indexOf(bienId) < 0) throw new Error("Vous n'avez pas accès à ce bien.");
}
