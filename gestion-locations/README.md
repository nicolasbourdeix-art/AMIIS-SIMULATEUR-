# Mes Locations — gestion des locations Airbnb (Google Apps Script)

Application web gratuite hébergée par Google : une **Google Sheet** sert de base de données,
les justificatifs sont rangés dans **Google Drive**, les alertes partent par **Gmail**.

## Ce que fait l'application

| Onglet | Contenu |
|---|---|
| 🏠 Accueil | Arrivées et départs des 14 prochains jours, alertes, **vérification d'une demande de réservation** avant de l'accepter |
| 📅 Calendrier | Planning mensuel des biens, jours de conflit en rouge |
| 🧹 Ménages | Pour Laetitia : ménages à faire, heure de départ, prochaine arrivée (⚡ si c'est le jour même), nombre de personnes, bouton « Ménage fait », notes |
| 🛏️ Réservations | Import automatique Airbnb (toutes les heures) + réservations hors Airbnb ; **montants récupérés automatiquement dans les emails Airbnb** |
| 💶 Revenus | Par bien et par mois : encaissé, part propriétaire, ma part, dépenses, net. Règle Tilh : jusqu'à 600 €/mois pour le propriétaire, le reste pour moi |
| 🧾 Justificatifs | Photo d'un ticket depuis le téléphone, ou PDF ; rangement automatique dans Drive (année/mois) ; envoi groupé au comptable avec récapitulatif tableur |
| ⚙️ Réglages | Biens, liens Airbnb, règles de partage, accès des personnes, emails, **chauffage & eau chaude (Home Assistant)** |

### Alertes de ménage
Les biens qui ont le même **groupe de ménage** (ex. `TILH` pour les deux logements mitoyens) sont surveillés ensemble :
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
| Ménage (Laetitia → Tilh 1 et 2) | Planning des ménages et calendrier de ses biens, **sans les montants** ; peut ajouter ses tickets |
| Comptable | Revenus et justificatifs, en lecture |

Laetitia reçoit chaque soir à 18h le programme du lendemain par email (si son email est renseigné).

### Montants récupérés automatiquement (emails Airbnb)
Le calendrier Airbnb ne contient pas les montants, mais chaque email **« Réservation confirmée »** reçu par l'hôte indique
le code de réservation et la ligne **« VOUS GAGNEZ … € »** (montant net versé, ménage compris, frais Airbnb déduits).
Toutes les heures, l'application lit ces emails dans Gmail (lecture seule), retrouve la réservation grâce au code
et remplit le montant, le nombre de voyageurs et le nom (avec une note « lit parapluie » s'il y a un bébé).

- Les montants lus dans un email sont marqués 📧, ceux saisis à la main ✍️. **Une saisie manuelle n'est jamais écrasée.**
- Si la réservation est modifiée, le dernier email reçu fait foi.
- ⚠️ Le script lit la boîte Gmail **du compte Google avec lequel il est créé et déployé** : créez-le avec le compte qui reçoit les emails Airbnb.
- Soustons : si les emails Airbnb arrivent chez Xavier, il peut les transférer automatiquement (filtre Gmail) ; ajoutez son adresse
  dans Réglages → Paramètres → « Emails transférés acceptés de ». Les autres expéditeurs sont ignorés.
- Bouton **📧 Récupérer les montants** dans l'onglet Réservations pour lancer la lecture tout de suite (elle remonte sur 13 mois).

### Chauffage et eau chaude pilotés par les réservations (Home Assistant)
L'application calcule en permanence le **mode de chauffage de chaque logement** et le **besoin d'eau chaude de chaque ballon** ;
Home Assistant vient les lire toutes les 10 minutes et les applique. Rien à exposer sur internet côté maison.

**Installation réglée par défaut :**

| Logement | Chauffage | Eau chaude |
|---|---|---|
| Tilh 1 | Plancher chauffant (pompe à chaleur) | Ballon commun « TILH » (pompe à chaleur) |
| Tilh 2 | Radiateurs sur pompe à chaleur | Ballon commun « TILH » |
| Soustons | Radiateurs électriques (boîtiers, réglage par température) | Ballon propre |

*Vérifiez quelle maison de Tilh a le plancher (Réglages → Chauffage & eau chaude) et inversez si besoin.*

**Chauffage (par logement)**

| Mode | Quand |
|---|---|
| Confort (20 °C) | pendant le séjour, et avant l'arrivée (préchauffage) |
| Ménage (éco) | quelques heures après le départ (sauf plancher chauffant) |
| Éco | logement vide mais arrivée proche |
| Inoccupé | logement vide plus longtemps |
| Arrêt | chauffage désactivé pour ce logement (été) |

Valeurs conseillées par type (bouton « Appliquer les valeurs conseillées ») :

| Type | Préchauffage | Inoccupé | Reste en éco si arrivée dans moins de | Baisse pendant le ménage |
|---|---|---|---|---|
| Plancher chauffant | 12 h | 15 °C | 72 h | non |
| Radiateurs sur pompe à chaleur | 3 h | 14 °C | 36 h | 2 h |
| Radiateurs électriques | 2 h | 12 °C | 24 h | 3 h |

**Eau chaude (par ballon)** — les logements qui partagent un ballon ont le même *groupe eau chaude* (ex. `TILH`) ;
le ballon chauffe dès qu'**au moins un** d'entre eux en a besoin, et ne s'arrête que quand plus personne n'est là.

| État | Quand | Consigne par défaut |
|---|---|---|
| Relance | 8 h avant une arrivée, même en heures pleines | 60 °C (assure aussi la sécurité sanitaire après un arrêt) |
| Marche | pendant un séjour | 52 °C |
| Arrêt | aucun voyageur ni arrivée proche | 40 °C, ou le mode arrêt / vacances du chauffe-eau |

---

## Installation (≈ 10 minutes)

1. Avec le compte Google **qui reçoit les emails Airbnb**, aller sur <https://script.google.com> → **Nouveau projet**. Le renommer « Mes Locations ».
2. Créer les fichiers et coller le contenu de ce dossier :
   - `Code.gs` (remplace le contenu par défaut), puis **+ → Script** pour `Data`, `Auth`, `Calendrier`, `Finances`, `Domotique`, `Emails`
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
   → crée `sensor.location_tilh_1_chauffage`, `sensor.location_tilh_2_chauffage`, `sensor.location_soustons_chauffage`,
   `sensor.location_tilh_eau_chaude`, `sensor.location_soustons_eau_chaude` et les capteurs d'occupation.
4. Copier les deux fichiers de `home-assistant/blueprints/automation/mes_locations/` dans
   `config/blueprints/automation/mes_locations/`, puis redémarrer Home Assistant.
5. Paramètres → Automatisations → Modèles :
   - **« Mes Locations — chauffage »** → une automatisation par logement, avec les entités de la carte correspondante :
     - Tilh 1 → le thermostat de la carte **Plancher chauffant** (zone de la pompe à chaleur) ;
     - Tilh 2 → le thermostat de la carte **Radiateur** ;
     - Soustons → les thermostats des boîtiers du tableau de bord **Soustons**.
   - **« Mes Locations — eau chaude »** → une automatisation pour Tilh avec l'entité de la carte **Eau chaude sanitaire**
     (en général un `water_heater` de la pompe à chaleur), et une pour Soustons si son ballon est pilotable.

Bon à savoir :
- La consigne de chauffage n'est envoyée **qu'au moment où elle change** : les voyageurs peuvent régler le thermostat pendant leur séjour.
- Laissez actif le cycle anti-légionelle de la pompe à chaleur s'il existe ; la relance à 60 °C avant chaque arrivée va dans le même sens.
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
