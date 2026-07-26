# 🎒 SacSim — support de sac à dos : simulateur élève + correcteur

Application web pour un projet de technologie au collège : les élèves conçoivent un support
qui se coince sur le bord d'une table pour y suspendre leur sac à dos, l'impriment en 3D, et
testent sa résistance **avant** de le fabriquer.

Deux pages, **aucune installation** — on ouvre le fichier dans un navigateur, tout tourne en local.

| Page | Pour qui | Ce qu'elle fait |
|---|---|---|
| `index.html` | élèves | importer son STL, l'insérer sur la table en 3D, tester la résistance |
| `correction.html` | professeur | déposer **tous** les STL de la classe → coupe de l'insertion, poids maximum, dimensions, **note /20**, export CSV |

## Le principe : un seul moteur de calcul

`js/sectionEngine.js` est la **source de vérité unique**. Le simulateur élève et le correcteur
l'appellent tous les deux : à géométrie et réglages identiques, ils affichent forcément le même
chiffre. C'est le point qui rend la note défendable devant un élève.

Tout se joue sur la **coupe 2D** du profil extrudé — pas de placement 3D approximatif :

1. **Coupe** — le maillage est tranché à plusieurs profondeurs, la tranche médiane fait foi.
2. **Fente** — balayage de rayons pour trouver les vides qui débouchent ; les candidats sont
   notés, pas pris au hasard.
3. **Insertion** — le plateau se coince dans la fente selon `S·cos θ − G·sin θ = T`
   (S = hauteur de fente, G = profondeur de prise, T = épaisseur du plateau).
   Trop de jeu → le support bascule et décroche. Fente trop petite → il n'entre pas.
4. **Résistance** — flexion d'Euler-Bernoulli section par section sur le bras libre, avec
   inertie composée, correction de pente et **concentration de contrainte aux angles vifs**.
   Un congé arrondi tient donc réellement mieux qu'une arête vive : la leçon est dans le calcul.

## Le correcteur en pratique

Les fichiers sont **corrigés dès leur dépôt**, sans clic. Changer un réglage relance le calcul.

Chaque carte montre la **coupe de l'insertion** — le support en place sur le plateau, coloré
selon la contrainte, avec la section qui casserait en premier — et le détail de la note.
Un clic sur la coupe ouvre la fiche complète (bras de levier, moment quadratique, congé, Kt,
jeu, basculement, détail du barème).

### Quand la lecture automatique se trompe

Le plan de coupe est trouvé de façon fiable, mais le sens d'insertion garde des ambiguïtés
qu'aucune géométrie ne tranche seule. Deux boutons sur chaque carte :

- **↕** retourne le support haut/bas ;
- **↻ i/n** passe à la lecture suivante de la pièce (ça la fait pivoter dans la table) ;
- **auto** revient au choix automatique.

Les corrections sont mémorisées par fichier, survivent à un recalcul, et le CSV en garde la trace.
Les copies dont la lecture est douteuse sont bordées d'orange et comptées dans « À vérifier » :
l'application préfère signaler un doute plutôt que d'afficher un chiffre faux.

### Réglages

Épaisseur du plateau (19 mm par défaut), tolérance d'ajustement, dimensions maximales,
plage de hauteur de fente, poids visé, répartition des points, et **contrainte admissible**
(20 MPa pour du PLA imprimé) — c'est ce dernier réglage qui rend l'épreuve plus ou moins sévère
pour toute la classe.

## Structure

```
index.html          simulateur élève (Three.js)
correction.html     correcteur par lot
sim-embed.html      simulateur embarquable (iframe, pour Éléa)
css/style.css
js/
  sectionEngine.js          ← moteur unique : coupe, insertion, résistance, rendu SVG
  app.js                    application élève
  viewer3d.js               scène 3D
  stlParser.js              lecture STL (binaire + ASCII)
  simulation2D.js           vue en coupe animée
  geometryAnalysisEngine.js coloration 3D des contraintes
  ui.js
```

## Crédits

Conception : **Max**, professeur de technologie · Développement assisté par Claude (Anthropic).
Application éducative à usage scolaire — 5ᵉ, 4ᵉ, 3ᵉ.
