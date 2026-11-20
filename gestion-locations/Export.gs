/**
 * Export.gs — Synchronisation dans l'autre sens : l'application → Airbnb.
 *
 * Pour chaque logement, l'application tient à jour un Google Agenda « Mes Locations — blocages … »
 * qui contient :
 *   - les dates bloquées à la main dans l'application (travaux, séjour perso…) ;
 *   - les réservations qui ne viennent pas d'Airbnb (location en direct, Booking…).
 * Dans Airbnb : Disponibilités → Synchronisation des calendriers → « Importer un calendrier »,
 * avec l'« adresse secrète au format iCal » de cet agenda. Airbnb le relit de lui-même
 * (toutes les quelques heures) et bloque ces dates.
 *
 * Les réservations Airbnb elles-mêmes ne sont jamais renvoyées vers Airbnb (pas de boucle).
 */

var TAG_EXPORT = 'mes-locations:';

function agendaBlocages_(bien, creer) {
  var props = PropertiesService.getScriptProperties();
  var cle = 'AGENDA_' + bien.id;
  var id = props.getProperty(cle);
  if (id) {
    try { var c = CalendarApp.getCalendarById(id); if (c) return c; } catch (e) { /* recréé ci-dessous */ }
  }
  if (!creer) return null;
  var cal = CalendarApp.createCalendar('Mes Locations — blocages ' + bien.nom, {
    summary: 'Dates à bloquer dans Airbnb pour « ' + bien.nom + ' ». Géré automatiquement par l\'application Mes Locations : ne pas modifier à la main.',
    timeZone: TZ, hidden: true, selected: false
  });
  props.setProperty(cle, cal.getId());
  return cal;
}

/** Entrées à envoyer vers Airbnb pour un logement. */
function entreesExport_(bienId, resas) {
  var depuis = ajouterJours_(aujourdhui_(), -1);
  return resas.filter(function (r) {
    return r.bien_id === bienId && r.statut !== 'annulée' && r.depart >= depuis &&
           r.source !== 'airbnb' &&
           (r.type === 'reservation' || (r.type === 'blocage' && r.source === 'manuel'));
  });
}

function dateLocale_(s) {
  var p = String(s).split('-');
  return new Date(+p[0], +p[1] - 1, +p[2]);
}

/** Met les agendas de blocage en accord avec les données de l'application. */
function synchroniserExport_() {
  var resas = lire_('Reservations');
  var rapport = [];
  tousBiens_().forEach(function (b) {
    var voulues = entreesExport_(b.id, resas);
    var cal = agendaBlocages_(b, voulues.length > 0);
    if (!cal) { rapport.push({ bien: b.nom, dates: 0 }); return; }

    var debut = dateLocale_(ajouterJours_(aujourdhui_(), -40)), fin = dateLocale_(ajouterJours_(aujourdhui_(), 800));
    var existants = {};
    cal.getEvents(debut, fin).forEach(function (ev) {
      var d = String(ev.getDescription() || '');
      var i = d.indexOf(TAG_EXPORT);
      if (i < 0) { return; }
      existants[d.slice(i + TAG_EXPORT.length).split(/\s/)[0]] = ev;
    });

    var gardes = {}, crees = 0, supprimes = 0;
    voulues.forEach(function (r) {
      var signature = r.id + '|' + r.arrivee + '|' + r.depart;
      gardes[signature] = true;
      if (existants[signature]) return;
      cal.createAllDayEvent('Indisponible', dateLocale_(r.arrivee), dateLocale_(r.depart),
        { description: (r.type === 'blocage' ? 'Dates bloquées' : 'Réservation ' + (r.source || '')) +
                       (r.notes ? ' — ' + r.notes : '') + '\n' + TAG_EXPORT + signature });
      crees++;
    });
    Object.keys(existants).forEach(function (sig) {
      if (!gardes[sig]) { try { existants[sig].deleteEvent(); supprimes++; } catch (e) { /* déjà supprimé */ } }
    });
    rapport.push({ bien: b.nom, dates: voulues.length, crees: crees, supprimes: supprimes });
  });
  return rapport;
}

function synchroniserExportSilencieux_() {
  try { return synchroniserExport_(); } catch (e) { console.error('Export Airbnb : ' + e.message); return null; }
}

/* ── Actions de l'interface ── */

function actBlocages_(u) {
  var ids = idsAutorises_(u), depuis = ajouterJours_(aujourdhui_(), -30);
  return lire_('Reservations').filter(function (r) {
    return ids.indexOf(r.bien_id) >= 0 && r.type === 'blocage' && r.source === 'manuel' && r.depart >= depuis;
  }).sort(function (a, b) { return a.arrivee < b.arrivee ? -1 : 1; })
    .map(function (r) { return { id: r.id, bien_id: r.bien_id, arrivee: r.arrivee, depart: r.depart, nuits: r.nuits, notes: r.notes }; });
}

function actBlocageSave_(u, p) {
  verifierBien_(u, p.bien_id);
  if (!estDate_(p.du) || !estDate_(p.au) || p.au < p.du) throw new Error('Dates invalides.');
  var depart = ajouterJours_(p.au, 1); // « au » = dernière nuit bloquée incluse
  var resas = lire_('Reservations');
  var chevauche = resasActives_(resas).filter(function (r) {
    return r.bien_id === p.bien_id && r.arrivee < depart && p.du < r.depart;
  });
  var r = {
    id: 'B' + Utilities.getUuid().slice(0, 8), bien_id: p.bien_id, source: 'manuel', type: 'blocage', uid: '', code: '',
    voyageur: 'Bloqué', arrivee: p.du, depart: depart, nuits: ecartJours_(p.du, depart), voyageurs: '', montant: '',
    statut: 'confirmée', notes: String(p.motif || '').slice(0, 200), tel4: '', maj_le: maintenant_(), montant_source: ''
  };
  sauver_('Reservations', r);
  journal_(u.identifiant, 'dates bloquées', r.bien_id + ' ' + r.arrivee + ' → ' + p.au);
  var exp = synchroniserExportSilencieux_();
  return { ok: true, avertissement: chevauche.length ? 'Attention : ' + chevauche.length + ' réservation(s) existent déjà sur ces dates.' : '', export_ok: !!exp };
}

function actExportInfos_() {
  return tousBiens_().map(function (b) {
    var cal = agendaBlocages_(b, false);
    return { bien_id: b.id, nom: b.nom, agenda: cal ? cal.getName() : '', cree: !!cal };
  });
}

function actExportCreer_(u) {
  tousBiens_().forEach(function (b) { agendaBlocages_(b, true); });
  var r = synchroniserExport_();
  journal_(u.identifiant, 'agendas de blocage créés', '');
  return { rapport: r, infos: actExportInfos_() };
}
