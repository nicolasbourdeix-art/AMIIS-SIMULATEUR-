# Mes Locations — gestion des locations Airbnb (Google Apps Script)

Application web gratuite hébergée par Google : une **Google Sheet** sert de base de données,
les justificatifs sont rangés dans **Google Drive**, les alertes partent par **Gmail**.

## Ce que fait l'application

| Onglet | Contenu |
|---|---|
| 🏠 Accueil | Arrivées et départs des 14 prochains jours, alertes, **vérification d'une demande de réservation** avant de l'accepter |
| 📅 Calendrier | Planning mensuel des biens, jours de conflit en rouge |
| 🧹 Ménages | Pour Laetitia : ménages à faire, heure de départ, prochaine arrivée (⚡ si c'est le jour même), nombre de personnes, bouton « Ménage fait », notes |
| 🛏️ Réservations | Import automatique Airbnb (toutes les heures) + réservations hors Airbnb ; saisie du montant net versé |
| 💶 Revenus | Par bien et par mois : encaissé, part propriétaire, ma part, dépenses, net. Règle Thiel : jusqu'à 600 €/mois pour le propriétaire, le reste pour moi |
| 🧾 Justificatifs | Photo d'un ticket depuis le téléphone, ou PDF ; rangement automatique dans Drive (année/mois) ; envoi groupé au comptable avec récapitulatif tableur |
| ⚙️ Réglages | Biens, liens Airbnb, règles de partage, accès des personnes, emails, **chauffage & eau chaude (Home Assistant)** |

### Alertes de ménage
Les biens qui ont le même **groupe de ménage** (ex. `THIEL` pour les deux logements mitoyens) sont surveillés ensemble :
- **2 départs le même jour** → alerte (deux ménages le même jour)
- **2 arrivées le même jour** → alerte (deux logements à préparer)
- deux réservations qui se chevauchent dans un même bien → alerte

Les alertes s'affichent dans l'application et un **email** part dès qu'un nouveau conflit apparaît après une synchro.

### Accès
Chaque personne a son identifiant + mot de passe (pas besoin de compte Google) :

| Rôle | Voit |
|---|---|
| Administrateur (Nicolas) | Tout |
| Gestionnaire (Xavier → Soustons) | Ses biens : réservations, montants, revenus, ménages, justificatifs |
| Ménage (Laetitia → Thiel 1 et 2) | Planning des ménages et calendrier de ses biens, **sans les montants** ; peut ajouter ses tickets |
| Comptable | Revenus et justificatifs, en lecture |

Laetitia reçoit chaque soir à 18h le programme du lendemain par email (si son email est renseigné).

### Chauffage et eau chaude pilotés par les réservations (Home Assistant)
L'application calcule en permanence, pour chaque logement, le **mode de chauffage** et le **besoin d'eau chaude** ;
Home Assistant vient les lire toutes les 10 minutes et pilote thermostats et ballons. Rien à exposer sur internet côté maison.

| Mode | Quand | Consigne par défaut |
|---|---|---|
| Confort | pendant le séjour, et **4 h avant l'arrivée** (préchauffage) | 20 °C |
| Ménage | **3 h après le départ** | 17 °C |
| Éco | logement vide mais arrivée dans moins de **36 h** | 17 °C |
| Inoccupé | logement vide plus longtemps | 12 °C |
| Arrêt | chauffage désactivé pour ce logement (été) | — |

**Eau chaude** : le ballon est relancé **8 h avant l'arrivée** (quel que soit le tarif), reste en service pendant le séjour
(uniquement en heures creuses si vous donnez un capteur d'heures creuses), et **s'arrête au départ**.
Tous ces réglages sont modifiables par logement (Réglages → Chauffage & eau chaude), avec le programme des prochains jours.

---

## Installation (≈ 10 minutes)

1. Aller sur <https://script.google.com> → **Nouveau projet**. Le renommer « Mes Locations ».
2. Créer les fichiers et coller le contenu de ce dossier :
   - `Code.gs` (remplace le contenu par défaut), puis **+ → Script** pour `Data`, `Auth`, `Calendrier`, `Finances`, `Domotique`
   - **+ → HTML** pour `Index` (coller `Index.html`)
   - ⚙️ Paramètres du projet → cocher « Afficher le fichier manifeste appsscript.json », puis coller `appsscript.json`
3. Dans la liste des fonctions en haut, choisir **`installer`** → ▶ **Exécuter** → accepter les autorisations Google.
   - Le journal d'exécution affiche le lien de la Google Sheet créée et les **mots de passe provisoires** de `nicolas`, `laetitia` et `xavier`. Les noter.
4. **Déployer → Nouveau déploiement** → type **Application Web** :
   - Exécuter en tant que : **Moi**
   - Qui a accès : **Tout le monde**
   - Copier l'URL `…/exec` : c'est l'adresse de l'application (à mettre en favori / sur l'écran d'accueil du téléphone).
5. Se connecter avec `nicolas`, aller dans **⚙️ Réglages** :
   - **Biens** : vérifier les noms, et coller pour chacun le **lien iCal Airbnb**
     (Airbnb → Annonces → le logement → Disponibilités → *Synchronisation des calendriers* → *Exporter le calendrier*).
   - **Paramètres** : email du comptable, email des alertes.
   - **Accès** : compléter les emails de Laetitia et Xavier, générer de nouveaux mots de passe si besoin.
6. Calendrier → **⟳ Synchroniser Airbnb** pour le premier import.

### Relier Home Assistant
1. Dans l'appli : **Réglages → Chauffage & eau chaude** → copier l'adresse (elle contient une clé secrète).
2. Dans Home Assistant, `secrets.yaml` :
   ```yaml
   mes_locations_url: "https://script.google.com/macros/s/XXXX/exec?ha=CLE"
   ```
3. Copier `home-assistant/mes_locations.yaml` dans `config/packages/` et activer les packages dans `configuration.yaml` :
   ```yaml
   homeassistant:
     packages: !include_dir_named packages
   ```
   → crée les capteurs `sensor.location_thiel_1`, `sensor.location_thiel_2`, `sensor.location_soustons`
   (état = mode, attributs = consigne, eau chaude, prochaine arrivée, programme…) et les capteurs d'occupation.
4. Copier `home-assistant/blueprints/automation/mes_locations/chauffage_ecs.yaml` dans `config/blueprints/automation/mes_locations/`,
   redémarrer Home Assistant.
5. Paramètres → Automatisations → Modèles → **« Mes Locations — chauffage et eau chaude »** → créer **une automatisation par logement** :
   capteur du logement, thermostat(s), interrupteur du ballon, et éventuellement le capteur d'heures creuses.

Bon à savoir :
- La consigne n'est envoyée **qu'au moment où elle change** : les voyageurs peuvent régler le thermostat pendant leur séjour.
- Si l'appli ne répond pas (coupure internet), Home Assistant ne change rien.
- Test rapide depuis un terminal : `curl -L "https://script.google.com/macros/s/XXXX/exec?ha=CLE"` doit renvoyer le JSON.
- Facultatif : l'adresse « calendrier des séjours » s'ajoute dans Home Assistant via l'intégration **Calendrier distant** (Remote Calendar).

> Après une modification du code : **Déployer → Gérer les déploiements → ✎ → Version : Nouvelle version** pour que l'URL utilise le nouveau code.

### Mot de passe administrateur perdu
Dans l'éditeur, ouvrir `Code.gs`, modifier les deux valeurs de `reinitialiserMotDePasse()`, puis exécuter cette fonction.

---

## Bon à savoir
- **Airbnb ne transmet pas les montants** dans le calendrier iCal : il faut saisir le montant net versé dans l'onglet Réservations (les séjours sans montant sont signalés « €? »).
- Une réservation qui disparaît du calendrier Airbnb (annulation) passe en « annulée » ; le montant et les notes saisis sont conservés.
- Les **demandes** de réservation non acceptées n'apparaissent pas dans le calendrier Airbnb : utiliser « Vérifier une demande » sur l'accueil avant d'accepter.
- Tout est modifiable directement dans la Google Sheet si besoin (onglets Biens, Reservations, Documents…).
