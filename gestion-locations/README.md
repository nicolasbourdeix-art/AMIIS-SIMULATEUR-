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
| ⚙️ Réglages | Biens, liens Airbnb, règles de partage, accès des personnes, emails |

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

---

## Installation (≈ 10 minutes)

1. Aller sur <https://script.google.com> → **Nouveau projet**. Le renommer « Mes Locations ».
2. Créer les fichiers et coller le contenu de ce dossier :
   - `Code.gs` (remplace le contenu par défaut), puis **+ → Script** pour `Data`, `Auth`, `Calendrier`, `Finances`
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

> Après une modification du code : **Déployer → Gérer les déploiements → ✎ → Version : Nouvelle version** pour que l'URL utilise le nouveau code.

### Mot de passe administrateur perdu
Dans l'éditeur, ouvrir `Code.gs`, modifier les deux valeurs de `reinitialiserMotDePasse()`, puis exécuter cette fonction.

---

## Bon à savoir
- **Airbnb ne transmet pas les montants** dans le calendrier iCal : il faut saisir le montant net versé dans l'onglet Réservations (les séjours sans montant sont signalés « €? »).
- Une réservation qui disparaît du calendrier Airbnb (annulation) passe en « annulée » ; le montant et les notes saisis sont conservés.
- Les **demandes** de réservation non acceptées n'apparaissent pas dans le calendrier Airbnb : utiliser « Vérifier une demande » sur l'accueil avant d'accepter.
- Tout est modifiable directement dans la Google Sheet si besoin (onglets Biens, Reservations, Documents…).
