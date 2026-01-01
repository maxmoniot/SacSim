# 🎒 Simulateur de Support de Sac à Dos

Application web éducative permettant aux élèves de collège de tester virtuellement la résistance de leurs supports de sac à dos imprimés en 3D avant de les fabriquer.

## 🎯 Objectif pédagogique

Cette application s'inscrit dans un projet de technologie où les élèves conçoivent et fabriquent un support permettant de suspendre un sac à dos au bord d'une table. Le simulateur leur permet de :

- Visualiser leur modèle 3D (fichier STL)
- Tester virtuellement la résistance de leur design
- Identifier les zones de fragilité
- Optimiser leur conception avant impression 3D

## ✨ Fonctionnalités

### Chargement et visualisation 3D
- Import de fichiers STL
- Visualisation interactive avec rotation et zoom
- Positionnement du support sur une table virtuelle

### Paramétrage
- **Position** : Ajustement X, Y, Z du support
- **Rotation** : Mode pas-à-pas (90°) ou libre (5°)
- **Épaisseur de table** : Réglable de 1 à 5 cm
- **Poids du sac** : Réglable de 1 à 10 kg

### Simulation physique
- Analyse basée sur les équations de flexion des poutres (Euler-Bernoulli)
- Calcul du poids maximum supportable
- Visualisation des zones de contrainte (gradient de couleur)
- Détection du point de rupture potentiel

### Matériaux
- **PLA** : Coefficient 1.0× (plastique impression 3D)
- **Bois** : Coefficient 4.0×
- **Métal** : Coefficient 8.0×
- **Personnalisé** : Coefficient libre (0.1 à 10×)

### Interface adaptée aux collégiens
- Tutoriel de bienvenue
- Messages clairs : "TIENT" / "VA CASSER"
- Indicateurs visuels simples
- Échelle de fragilité colorée

## 🚀 Installation

1. Cloner ou télécharger le projet
2. Placer les fichiers sur un serveur web (Apache, Nginx, ou serveur local)
3. Ouvrir `index.html` dans un navigateur moderne

### Structure des fichiers

```
sac-sim/
├── index.html
├── README.md
├── css/
│   └── style.css
└── js/
    ├── app.js                    # Application principale
    ├── viewer3d.js               # Visualisation Three.js
    ├── stlParser.js              # Parseur de fichiers STL
    ├── physicsSimulator.js       # Simulation physique
    ├── geometryAnalysisEngine.js # Analyse géométrique
    ├── simulation2D.js           # Simulation 2D (flexion)
    └── ui.js                     # Gestion de l'interface
```

## 📖 Utilisation

### Étape 1 : Charger un fichier STL
Cliquer sur "Choisir un fichier STL" pour importer le modèle 3D du support.

### Étape 2 : Positionner le support
- Utiliser les sliders de position pour placer le support sur la table
- Ajuster la rotation si nécessaire
- Le support doit avoir une partie sur la table et une partie qui dépasse

### Étape 3 : Définir le point d'accrochage
Cliquer sur le modèle 3D à l'endroit où le sac sera accroché (généralement le point le plus bas du support).

### Étape 4 : Lancer la simulation
- Régler le poids du sac à tester
- Cliquer sur "Lancer la simulation"
- Observer les résultats et les zones colorées

### Interprétation des résultats

| Couleur | Signification |
|---------|---------------|
| 🔵 Bleu | Zone solide |
| 🟢 Vert | Zone correcte |
| 🟡 Jaune | Zone sous tension |
| 🔴 Rouge | Zone fragile / risque de rupture |

## ⚙️ Configuration avancée

### Réglages (bouton ⚙️)
Permet de changer le matériau simulé et ainsi ajuster les calculs de résistance.

### Garde-fous
L'application bloque la simulation si :
- Le support n'est pas positionné sur la table
- Le point d'accrochage n'est pas sur le support

## 🛠️ Technologies utilisées

- **Three.js** : Rendu 3D WebGL
- **JavaScript ES6+** : Logique applicative
- **CSS3** : Interface responsive
- **HTML5** : Structure

## 📐 Modèle physique

La simulation utilise la théorie des poutres d'Euler-Bernoulli :

- **Moment d'inertie** : `I = b × h³ / 12`
- **Contrainte de flexion** : `σ = M × c / I`
- **Déflexion** : `δ = F × L³ / (3 × E × I)`

Où :
- `b` = largeur de la section
- `h` = épaisseur de la section
- `M` = moment de flexion
- `c` = distance au centre
- `F` = force appliquée
- `L` = bras de levier
- `E` = module d'Young du matériau

## 👥 Crédits

- **Conception** : Max (enseignant de technologie)
- **Développement** : Claude.ai (Anthropic)

## 📄 Licence

Application éducative à usage scolaire.

---

*Application créée pour l'enseignement de la technologie au collège - Classes de 5ème, 4ème, 3ème*
