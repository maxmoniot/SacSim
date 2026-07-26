/**
 * STL Backpack Support Analyzer v3
 * =================================
 * API JavaScript pour analyser des fichiers STL de supports de sac à dos.
 * 
 * Détection robuste par balayage de rayons (ray scanning) :
 * fonctionne avec des formes arrondies, chanfreinées, ou variées.
 * 
 * Détecte :
 *  - L'orientation de la pièce
 *  - La hauteur de la fente
 *  - Point bleu : intérieur fente (côté ouverture, surface mâchoire longue)
 *  - Point vert : fin de la fente intérieure (paroi intérieure)
 *  - Point violet : position du sac (milieu extension mâchoire longue)
 *  - Données d'orientation complètes pour repositionnement
 *  - Alignement sur le point vert
 * 
 * Usage :
 *   const analyzer = require('./stl-backpack-analyzer');
 *   const result = analyzer.analyzeFile('support.stl');
 *   const results = analyzer.analyzeBatch(['f1.stl', 'f2.stl']);
 */

// Browser-adapted version - no Node.js dependencies
const EPSILON = 0.001;

// ===========================================================================
// STL PARSER (binaire + ASCII)
// ===========================================================================

function parseSTL(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const header = new TextDecoder('ascii').decode(bytes.slice(0, Math.min(80, bytes.length))).trim();
  const first300 = new TextDecoder('ascii').decode(bytes.slice(0, Math.min(300, bytes.length)));
  if (header.startsWith('solid') && first300.includes('facet'))
    return parseSTLAscii(new TextDecoder('ascii').decode(bytes));
  return parseSTLBinary(arrayBuffer);
}

function parseSTLBinary(arrayBuffer) {
  const dv = new DataView(arrayBuffer);
  const numTri = dv.getUint32(80, true);
  const triangles = []; const bounds = newBounds();
  let off = 84;
  for (let i = 0; i < numTri; i++) {
    const normal = { x: dv.getFloat32(off, true), y: dv.getFloat32(off+4, true), z: dv.getFloat32(off+8, true) }; off += 12;
    const vertices = [];
    for (let v = 0; v < 3; v++) {
      const vt = { x: dv.getFloat32(off, true), y: dv.getFloat32(off+4, true), z: dv.getFloat32(off+8, true) }; off += 12;
      vertices.push(vt); expandBounds(bounds, vt);
    }
    off += 2;
    triangles.push({ normal, vertices });
  }
  return { triangles, bounds };
}

function parseSTLAscii(text) {
  const triangles = []; const bounds = newBounds();
  const re = /facet\s+normal\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s+outer\s+loop\s+vertex\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s+vertex\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s+vertex\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s+endloop\s+endfacet/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const normal = { x: +m[1], y: +m[2], z: +m[3] };
    const vertices = [{ x:+m[4], y:+m[5], z:+m[6] }, { x:+m[7], y:+m[8], z:+m[9] }, { x:+m[10], y:+m[11], z:+m[12] }];
    for (const v of vertices) expandBounds(bounds, v);
    triangles.push({ normal, vertices });
  }
  return { triangles, bounds };
}

function newBounds() {
  return { min: { x: Infinity, y: Infinity, z: Infinity }, max: { x: -Infinity, y: -Infinity, z: -Infinity } };
}
function expandBounds(b, v) {
  b.min.x = Math.min(b.min.x, v.x); b.min.y = Math.min(b.min.y, v.y); b.min.z = Math.min(b.min.z, v.z);
  b.max.x = Math.max(b.max.x, v.x); b.max.y = Math.max(b.max.y, v.y); b.max.z = Math.max(b.max.z, v.z);
}

// ===========================================================================
// GEOMETRY UTILITIES
// ===========================================================================

function round(v, p = 2) { return Math.round(v * 10**p) / 10**p; }
function roundPt(pt) { return { x: round(pt.x), y: round(pt.y), z: round(pt.z) }; }
function vKey(v) { return v.x.toFixed(2) + ',' + v.y.toFixed(2); }
function eKey(a, b) { const ka = vKey(a), kb = vKey(b); return ka < kb ? ka+'|'+kb : kb+'|'+ka; }

// ===========================================================================
// CROSS-SECTION EXTRACTION
// ===========================================================================

/**
 * Détecte l'axe d'extrusion de la pièce.
 * 
 * Pour un profil extrudé, les coordonnées le long de l'axe d'extrusion
 * ne prennent que 2 valeurs (min et max des caps), contrairement aux axes
 * du profil qui ont plein de valeurs (sommets du contour).
 */
function detectExtrusionAxis(bounds, triangles) {
  if (triangles && triangles.length > 0) {
    const distinctCounts = {};
    for (const axis of ['x', 'y', 'z']) {
      const values = new Set();
      for (const t of triangles) {
        for (const v of t.vertices) {
          values.add(Math.round(v[axis] * 100) / 100);
        }
      }
      distinctCounts[axis] = values.size;
    }
    
    // L'axe d'extrusion a le MOINS de valeurs distinctes (idéalement 2)
    const sorted = Object.entries(distinctCounts).sort((a, b) => a[1] - b[1]);
    return sorted[0][0];
  }
  
  // Fallback : plus petit axe
  const s = { 
    x: bounds.max.x - bounds.min.x, 
    y: bounds.max.y - bounds.min.y, 
    z: bounds.max.z - bounds.min.z 
  };
  return Object.entries(s).sort((a, b) => a[1] - b[1])[0][0];
}

/**
 * Extrait le polygone 2D de la coupe transversale.
 * 
 * Méthode robuste par TRANCHAGE : on coupe le modèle au milieu de l'axe
 * d'extrusion avec un plan, et on récupère les segments d'intersection.
 * Fonctionne avec des formes courbes, chanfreinées, etc.
 * 
 * Fallback sur la méthode boundary-edge si le slicing ne donne rien.
 */
function extractCrossSection(triangles, bounds, extrusionAxis) {
  const axes = ['x','y','z'].filter(a => a !== extrusionAxis);
  const ax1 = axes[0], ax2 = axes[1];
  
  // Trancher au milieu de l'extrusion
  const slicePos = (bounds.min[extrusionAxis] + bounds.max[extrusionAxis]) / 2;
  const sliceResult = sliceTriangles(triangles, extrusionAxis, slicePos, ax1, ax2);
  
  if (sliceResult && sliceResult.length >= 4) {
    return { polygon: sliceResult, ax1, ax2 };
  }
  
  // Fallback : méthode boundary-edge (pour les formes simples)
  return extractCrossSectionBoundary(triangles, bounds, extrusionAxis, ax1, ax2);
}

/**
 * Tranche les triangles avec un plan perpendiculaire à l'axe donné.
 * Retourne le contour 2D ordonné.
 */
function sliceTriangles(triangles, axis, pos, ax1, ax2) {
  const segments = [];
  
  for (const tri of triangles) {
    const v = tri.vertices;
    const d = v.map(vert => vert[axis] - pos); // distance signée au plan
    
    // Vérifier si le triangle traverse le plan
    const above = d.filter(x => x > EPSILON).length;
    const below = d.filter(x => x < -EPSILON).length;
    
    if (above === 0 || below === 0) continue; // pas d'intersection
    
    // Trouver les 2 points d'intersection
    const pts = [];
    for (let i = 0; i < 3; i++) {
      const j = (i + 1) % 3;
      if (d[i] * d[j] < 0) {
        // L'arête i-j traverse le plan
        const t = d[i] / (d[i] - d[j]);
        pts.push({
          x: v[i][ax1] + t * (v[j][ax1] - v[i][ax1]),
          y: v[i][ax2] + t * (v[j][ax2] - v[i][ax2])
        });
      }
    }
    // Cas spécial : un sommet exactement sur le plan
    for (let i = 0; i < 3; i++) {
      if (Math.abs(d[i]) <= EPSILON) {
        pts.push({ x: v[i][ax1], y: v[i][ax2] });
      }
    }
    
    if (pts.length >= 2) {
      segments.push([pts[0], pts[1]]);
    }
  }
  
  if (segments.length < 3) return null;
  
  // Chaîner les segments en un polygone fermé
  return chainSegments(segments);
}

/**
 * Chaîne des segments non ordonnés en un contour fermé.
 * Gère les cas avec plusieurs contours (gravures, trous, décorations)
 * en retournant le plus grand contour (plus grande aire englobante).
 */
function chainSegments(segments) {
  if (segments.length === 0) return [];
  
  const CHAIN_TOL = 0.5;
  const used = new Array(segments.length).fill(false);
  
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  
  function findChain(startIdx) {
    const chain = [];
    used[startIdx] = true;
    chain.push(segments[startIdx][0]);
    chain.push(segments[startIdx][1]);
    
    let changed = true;
    while (changed) {
      changed = false;
      const last = chain[chain.length - 1];
      let bestIdx = -1, bestDist = CHAIN_TOL, bestEnd = 0;
      
      for (let i = 0; i < segments.length; i++) {
        if (used[i]) continue;
        const da = dist(last, segments[i][0]);
        const db = dist(last, segments[i][1]);
        if (da < bestDist) { bestDist = da; bestIdx = i; bestEnd = 0; }
        if (db < bestDist) { bestDist = db; bestIdx = i; bestEnd = 1; }
      }
      
      if (bestIdx >= 0) {
        used[bestIdx] = true;
        chain.push(bestEnd === 0 ? segments[bestIdx][1] : segments[bestIdx][0]);
        changed = true;
      }
    }
    return chain;
  }
  
  // Trouver toutes les chaînes
  const chains = [];
  for (let i = 0; i < segments.length; i++) {
    if (!used[i]) {
      const chain = findChain(i);
      if (chain.length >= 3) chains.push(chain);
    }
  }
  
  if (chains.length === 0) return [];
  if (chains.length === 1) return chains[0];
  
  // Retourner le contour avec la plus grande aire englobante
  let best = chains[0], bestArea = 0;
  for (const c of chains) {
    const xs = c.map(p => p.x);
    const ys = c.map(p => p.y);
    const area = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
    if (area > bestArea) { bestArea = area; best = c; }
  }
  
  return best;
}

/**
 * Fallback : extraction par boundary-edge (méthode originale).
 */
function extractCrossSectionBoundary(triangles, bounds, extrusionAxis, ax1, ax2) {
  const faces = triangles.filter(t => t.normal[extrusionAxis] > 0.5);
  const ec = new Map(), ev = new Map();
  for (const tri of faces) {
    const v2d = tri.vertices.map(v => ({ x: v[ax1], y: v[ax2] }));
    for (let i = 0; i < 3; i++) {
      const a = v2d[i], b = v2d[(i+1)%3];
      const k = eKey(a, b);
      ec.set(k, (ec.get(k)||0)+1);
      if (!ev.has(k)) ev.set(k, [a, b]);
    }
  }
  const be = [];
  for (const [k, c] of ec) { if (c === 1) be.push(ev.get(k)); }
  if (be.length === 0) throw new Error("Impossible d'extraire le contour 2D.");
  return { polygon: chainEdges(be), ax1, ax2 };
}

function chainEdges(edges) {
  if (!edges.length) return [];
  const adj = new Map();
  for (const [a, b] of edges) {
    const ka = vKey(a), kb = vKey(b);
    if (!adj.has(ka)) adj.set(ka, []);
    if (!adj.has(kb)) adj.set(kb, []);
    adj.get(ka).push({ key: kb, point: b });
    adj.get(kb).push({ key: ka, point: a });
  }
  const poly = [], visited = new Set();
  let ck = vKey(edges[0][0]), cp = edges[0][0];
  while (ck && !visited.has(ck)) {
    visited.add(ck);
    poly.push({...cp});
    const n = (adj.get(ck)||[]).find(n => !visited.has(n.key));
    if (n) { ck = n.key; cp = n.point; } else break;
  }
  return poly;
}

// ===========================================================================
// ROBUST SLOT DETECTION (RAY SCANNING)
// ===========================================================================

/**
 * Point-in-polygon test (ray casting algorithm).
 * Robuste pour les polygones complexes (arrondis, etc.)
 */
function pointInPolygon(px, py, polygon) {
  let inside = false;
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Trouve les intersections d'un rayon horizontal avec le polygone.
 * Retourne les X d'intersection triés.
 */
function rayIntersectsPolygonX(py, polygon) {
  const intersections = [];
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const yi = polygon[i].y, yj = polygon[j].y;
    const xi = polygon[i].x, xj = polygon[j].x;
    if ((yi > py) !== (yj > py)) {
      const xInt = (xj - xi) * (py - yi) / (yj - yi) + xi;
      intersections.push(xInt);
    }
  }
  return intersections.sort((a, b) => a - b);
}

/**
 * Trouve les intersections d'un rayon vertical avec le polygone.
 * Retourne les Y d'intersection triés.
 */
function rayIntersectsPolygonY(px, polygon) {
  const intersections = [];
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].x, xj = polygon[j].x;
    const yi = polygon[i].y, yj = polygon[j].y;
    if ((xi > px) !== (xj > px)) {
      const yInt = (yj - yi) * (px - xi) / (xj - xi) + yi;
      intersections.push(yInt);
    }
  }
  return intersections.sort((a, b) => a - b);
}

/**
 * Détection robuste de la fente par balayage de rayons.
 * 
 * Principe : on lance des rayons depuis chaque côté du bounding box
 * et on cherche les zones où le rayon traverse un "trou" (entre 2 segments solides).
 * La fente est la zone avec un trou systématique qui s'ouvre sur un bord.
 * 
 * Fonctionne avec des formes arrondies, chanfreinées, ou irrégulières.
 */
function detectSlotRobust(polygon) {
  const polyBounds = {
    minX: Math.min(...polygon.map(p => p.x)),
    maxX: Math.max(...polygon.map(p => p.x)),
    minY: Math.min(...polygon.map(p => p.y)),
    maxY: Math.max(...polygon.map(p => p.y))
  };
  
  const width = polyBounds.maxX - polyBounds.minX;
  const height = polyBounds.maxY - polyBounds.minY;
  
  // Nombre de rayons pour le balayage (assez dense pour les détails)
  const NUM_RAYS = 200;
  
  // === Scan horizontal (rayons dans la direction X, balayage en Y) ===
  const hGaps = scanHorizontalGaps(polygon, polyBounds, NUM_RAYS);
  
  // === Scan vertical (rayons dans la direction Y, balayage en X) ===
  const vGaps = scanVerticalGaps(polygon, polyBounds, NUM_RAYS);
  
  // La fente est l'ensemble de gaps continu le plus important
  // qui s'ouvre sur un bord du polygone
  const hSlot = findBestSlot(hGaps, polyBounds.minY, polyBounds.maxY, 'horizontal');
  const vSlot = findBestSlot(vGaps, polyBounds.minX, polyBounds.maxX, 'vertical');
  
  // Choisir le meilleur candidat (le plus grand)
  let slot;
  if (!hSlot && !vSlot) throw new Error("Aucune fente détectée dans la forme.");
  if (!hSlot) slot = vSlot;
  else if (!vSlot) slot = hSlot;
  else slot = (hSlot.area >= vSlot.area) ? hSlot : vSlot;
  
  return slot;
}

/**
 * Scan horizontal : pour chaque Y, lance un rayon en X et cherche les "trous".
 * Note : un scan horizontal détecte une fente VERTICALE (qui s'ouvre en haut/bas).
 * On track la position Y du rayon par rapport aux bords Y du polygone.
 */
function scanHorizontalGaps(polygon, polyBounds, numRays) {
  const gaps = [];
  const step = (polyBounds.maxY - polyBounds.minY) / (numRays + 1);
  
  for (let i = 1; i <= numRays; i++) {
    const y = polyBounds.minY + i * step;
    const xs = rayIntersectsPolygonX(y, polygon);
    
    if (xs.length >= 4) {
      for (let j = 1; j < xs.length - 1; j += 2) {
        const gapStart = xs[j];
        const gapEnd = xs[j + 1];
        const gapWidth = gapEnd - gapStart;
        
        if (gapWidth > step * 0.5) {
          gaps.push({
            y,
            gapStart,  // X début du gap
            gapEnd,    // X fin du gap
            gapWidth,
            // Pour une fente verticale, l'ouverture est côté Y (haut/bas)
            touchesLeft: Math.abs(y - polyBounds.minY) < step * 2,  // near bottom
            touchesRight: Math.abs(y - polyBounds.maxY) < step * 2   // near top
          });
        }
      }
    }
  }
  
  return gaps;
}

/**
 * Scan vertical : pour chaque X, lance un rayon en Y et cherche les gaps.
 * Note : un scan vertical détecte une fente HORIZONTALE (qui s'ouvre à gauche/droite).
 * On track la position X du rayon par rapport aux bords X du polygone.
 */
function scanVerticalGaps(polygon, polyBounds, numRays) {
  const gaps = [];
  const step = (polyBounds.maxX - polyBounds.minX) / (numRays + 1);
  
  for (let i = 1; i <= numRays; i++) {
    const x = polyBounds.minX + i * step;
    const ys = rayIntersectsPolygonY(x, polygon);
    
    if (ys.length >= 4) {
      for (let j = 1; j < ys.length - 1; j += 2) {
        const gapStart = ys[j];
        const gapEnd = ys[j + 1];
        const gapWidth = gapEnd - gapStart;
        
        if (gapWidth > step * 0.5) {
          gaps.push({
            x,
            gapStart,  // Y début du gap
            gapEnd,    // Y fin du gap
            gapWidth,
            // Pour une fente horizontale, l'ouverture est côté X (gauche/droite)
            touchesLeft: Math.abs(x - polyBounds.minX) < step * 2,
            touchesRight: Math.abs(x - polyBounds.maxX) < step * 2
          });
        }
      }
    }
  }
  
  return gaps;
}

/**
 * À partir des gaps détectés, identifie la fente principale.
 * La fente est un ensemble continu de gaps qui s'ouvre sur un bord.
 */
function findBestSlot(gaps, rangeMin, rangeMax, direction) {
  if (gaps.length === 0) return null;
  
  // Regrouper les gaps adjacents en clusters (même zone de gap)
  // On utilise un binning sur la position du gap
  const tolerance = (rangeMax - rangeMin) / 50;
  
  // Cluster par position moyenne du gap
  const clusters = [];
  const sorted = [...gaps].sort((a, b) => {
    const posA = (a.gapStart + a.gapEnd) / 2;
    const posB = (b.gapStart + b.gapEnd) / 2;
    return posA - posB;
  });
  
  let currentCluster = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const prevMid = (currentCluster[currentCluster.length-1].gapStart + currentCluster[currentCluster.length-1].gapEnd) / 2;
    const currMid = (sorted[i].gapStart + sorted[i].gapEnd) / 2;
    
    if (Math.abs(currMid - prevMid) < tolerance * 5) {
      currentCluster.push(sorted[i]);
    } else {
      clusters.push(currentCluster);
      currentCluster = [sorted[i]];
    }
  }
  clusters.push(currentCluster);
  
  // Pour chaque cluster, calculer les paramètres de la fente
  let bestSlot = null;
  
  for (const cluster of clusters) {
    // Étendue du balayage (range des Y pour horizontal, X pour vertical)
    let scanMin, scanMax;
    if (direction === 'horizontal') {
      scanMin = Math.min(...cluster.map(g => g.y));
      scanMax = Math.max(...cluster.map(g => g.y));
    } else {
      scanMin = Math.min(...cluster.map(g => g.x));
      scanMax = Math.max(...cluster.map(g => g.x));
    }
    
    // Étendue du gap (profondeur de la fente)
    const gapStarts = cluster.map(g => g.gapStart);
    const gapEnds = cluster.map(g => g.gapEnd);
    
    // Valeurs médianes pour robustesse (ignore les outliers)
    gapStarts.sort((a,b) => a-b);
    gapEnds.sort((a,b) => a-b);
    const medIdx = Math.floor(cluster.length / 2);
    const medGapStart = gapStarts[medIdx];
    const medGapEnd = gapEnds[medIdx];
    
    // Min/max pour les surfaces exactes
    const innerSurface1 = Math.min(...gapStarts); // côté ouverture
    const innerSurface2 = Math.max(...gapEnds);   // côté fond
    
    // La fente s'ouvre sur le côté le plus stable (écart-type le plus petit)
    const startStd = std(gapStarts);
    const endStd = std(gapEnds);
    
    const slotSpan = scanMax - scanMin;     // hauteur de la fente
    const slotDepth = medGapEnd - medGapStart; // profondeur de la fente
    const area = slotSpan * slotDepth;
    
    // Déterminer de quel côté s'ouvre la fente
    let opensOnMin = false, opensOnMax = false;
    opensOnMin = cluster.some(g => g.touchesLeft);
    opensOnMax = cluster.some(g => g.touchesRight);
    
    // La fente doit s'ouvrir sur exactement un côté (sinon c'est un trou traversant)
    // Si aucun côté n'est détecté, on prend le côté avec le plus de gaps proches du bord
    
    if (slotSpan < 1 || slotDepth < 1) continue; // trop petit
    
    const slot = {
      direction,
      scanMin, scanMax,
      gapStart: medGapStart,
      gapEnd: medGapEnd,
      innerSurface1: Math.max(...gapStarts), // paroi la plus « rentrée » côté ouverture
      innerSurface2: Math.min(...gapEnds),   // paroi la plus « rentrée » côté fond
      slotHeight: slotSpan,
      slotDepth,
      area,
      opensOnMin, opensOnMax,
      clusterSize: cluster.length
    };
    
    if (!bestSlot || area > bestSlot.area) {
      bestSlot = slot;
    }
  }
  
  return bestSlot;
}

function std(values) {
  const mean = values.reduce((a,b) => a+b, 0) / values.length;
  return Math.sqrt(values.reduce((s, v) => s + (v-mean)**2, 0) / values.length);
}

/**
 * Raffine les bornes de la fente par recherche binaire.
 * Le scan initial utilise un pas discret — on affine ici pour obtenir
 * des positions précises au dixième de mm.
 */
function refineSlotBounds(rawSlot, polygon, polyBounds) {
  const result = { ...rawSlot };
  const STEPS = 20; // itérations de binary search
  
  if (rawSlot.direction === 'vertical') {
    // scanMin/scanMax = bornes X, gapStart/gapEnd = bornes Y du gap
    // Raffiner scanMin (X le plus petit avec un gap)
    result.scanMin = binarySearchBoundary(
      polyBounds.minX, rawSlot.scanMin + 1, STEPS,
      x => hasVerticalGap(x, polygon, rawSlot.gapStart, rawSlot.gapEnd)
    );
    // Raffiner scanMax (X le plus grand avec un gap)
    result.scanMax = binarySearchBoundary(
      rawSlot.scanMax - 1, polyBounds.maxX, STEPS,
      x => !hasVerticalGap(x, polygon, rawSlot.gapStart, rawSlot.gapEnd)
    );
    // Raffiner gapStart/gapEnd (bornes Y du gap) au milieu de la fente
    const midX = (result.scanMin + result.scanMax) / 2;
    const ys = rayIntersectsPolygonY(midX, polygon);
    if (ys.length >= 4) {
      // Trouver le gap le plus proche des valeurs brutes
      for (let j = 1; j < ys.length - 1; j += 2) {
        if (Math.abs(ys[j] - rawSlot.gapStart) < 5 && Math.abs(ys[j+1] - rawSlot.gapEnd) < 5) {
          result.gapStart = ys[j];
          result.gapEnd = ys[j + 1];
          break;
        }
      }
    }
  } else {
    // Horizontal: scanMin/scanMax = bornes Y, gapStart/gapEnd = bornes X
    result.scanMin = binarySearchBoundary(
      polyBounds.minY, rawSlot.scanMin + 1, STEPS,
      y => hasHorizontalGap(y, polygon, rawSlot.gapStart, rawSlot.gapEnd)
    );
    result.scanMax = binarySearchBoundary(
      rawSlot.scanMax - 1, polyBounds.maxY, STEPS,
      y => !hasHorizontalGap(y, polygon, rawSlot.gapStart, rawSlot.gapEnd)
    );
    const midY = (result.scanMin + result.scanMax) / 2;
    const xs = rayIntersectsPolygonX(midY, polygon);
    if (xs.length >= 4) {
      for (let j = 1; j < xs.length - 1; j += 2) {
        if (Math.abs(xs[j] - rawSlot.gapStart) < 5 && Math.abs(xs[j+1] - rawSlot.gapEnd) < 5) {
          result.gapStart = xs[j];
          result.gapEnd = xs[j + 1];
          break;
        }
      }
    }
  }
  
  return result;
}

function binarySearchBoundary(lo, hi, steps, testFn) {
  for (let i = 0; i < steps; i++) {
    const mid = (lo + hi) / 2;
    if (testFn(mid)) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

function hasVerticalGap(x, polygon, expectedGapMin, expectedGapMax) {
  const ys = rayIntersectsPolygonY(x, polygon);
  if (ys.length < 4) return false;
  for (let j = 1; j < ys.length - 1; j += 2) {
    const gapMid = (ys[j] + ys[j+1]) / 2;
    const expectedMid = (expectedGapMin + expectedGapMax) / 2;
    if (Math.abs(gapMid - expectedMid) < (expectedGapMax - expectedGapMin)) return true;
  }
  return false;
}

function hasHorizontalGap(y, polygon, expectedGapMin, expectedGapMax) {
  const xs = rayIntersectsPolygonX(y, polygon);
  if (xs.length < 4) return false;
  for (let j = 1; j < xs.length - 1; j += 2) {
    const gapMid = (xs[j] + xs[j+1]) / 2;
    const expectedMid = (expectedGapMin + expectedGapMax) / 2;
    if (Math.abs(gapMid - expectedMid) < (expectedGapMax - expectedGapMin)) return true;
  }
  return false;
}

/**
 * Convertit le résultat du scan en format structuré.
 * 
 * IMPORTANT : 
 *  - Un scan VERTICAL (rayons en Y) détecte une fente HORIZONTALE (ouvre gauche/droite)
 *  - Un scan HORIZONTAL (rayons en X) détecte une fente VERTICALE (ouvre haut/bas)
 */
function processSlotResult(rawSlot, polygon, polyBounds) {
  // Raffiner les bornes par recherche binaire pour plus de précision
  const refined = refineSlotBounds(rawSlot, polygon, polyBounds);
  
  if (refined.direction === 'vertical') {
    // Scan vertical → fente HORIZONTALE (slotAxis = 'x')
    // scanMin/scanMax = étendue en X (profondeur de la fente)
    // gapStart/gapEnd = étendue en Y (hauteur de la fente)
    
    let openingSide, openingPos, innerWallPos;
    
    if (refined.opensOnMin && !refined.opensOnMax) {
      // Ouvre à gauche (X min)
      openingSide = 'left';
      openingPos = refined.scanMin;       // X de l'ouverture
      innerWallPos = refined.scanMax;     // X de la paroi intérieure
    } else if (refined.opensOnMax && !refined.opensOnMin) {
      openingSide = 'right';
      openingPos = refined.scanMax;
      innerWallPos = refined.scanMin;
    } else {
      // Heuristique : le côté le plus proche du bord du polygone
      const dLeft = Math.abs(refined.scanMin - polyBounds.minX);
      const dRight = Math.abs(refined.scanMax - polyBounds.maxX);
      if (dLeft <= dRight) {
        openingSide = 'left';
        openingPos = refined.scanMin;
        innerWallPos = refined.scanMax;
      } else {
        openingSide = 'right';
        openingPos = refined.scanMax;
        innerWallPos = refined.scanMin;
      }
    }
    
    return {
      slotHeight: refined.gapEnd - refined.gapStart,   // hauteur Y
      slotDepth: refined.scanMax - refined.scanMin,     // profondeur X
      openingSide,
      slotAxis: 'x',
      innerWallPos,
      openingPos,
      slotBounds: {
        xMin: refined.scanMin,
        xMax: refined.scanMax,
        yMin: refined.gapStart,
        yMax: refined.gapEnd
      }
    };
    
  } else {
    // Scan horizontal → fente VERTICALE (slotAxis = 'y')
    // scanMin/scanMax = étendue en Y (profondeur de la fente)
    // gapStart/gapEnd = étendue en X (hauteur de la fente)
    
    let openingSide, openingPos, innerWallPos;
    
    if (refined.opensOnMin && !refined.opensOnMax) {
      openingSide = 'bottom';
      openingPos = refined.scanMin;
      innerWallPos = refined.scanMax;
    } else if (refined.opensOnMax && !refined.opensOnMin) {
      openingSide = 'top';
      openingPos = refined.scanMax;
      innerWallPos = refined.scanMin;
    } else {
      const dBot = Math.abs(refined.scanMin - polyBounds.minY);
      const dTop = Math.abs(refined.scanMax - polyBounds.maxY);
      if (dBot <= dTop) {
        openingSide = 'bottom';
        openingPos = refined.scanMin;
        innerWallPos = refined.scanMax;
      } else {
        openingSide = 'top';
        openingPos = refined.scanMax;
        innerWallPos = refined.scanMin;
      }
    }
    
    return {
      slotHeight: refined.gapEnd - refined.gapStart,   // hauteur X
      slotDepth: refined.scanMax - refined.scanMin,     // profondeur Y
      openingSide,
      slotAxis: 'y',
      innerWallPos,
      openingPos,
      slotBounds: {
        xMin: refined.gapStart,
        xMax: refined.gapEnd,
        yMin: refined.scanMin,
        yMax: refined.scanMax
      }
    };
  }
}

// ===========================================================================
// KEY POINTS COMPUTATION
// ===========================================================================

function computeKeyPoints(polygon, slotInfo, bounds3D, extrusionAxis, ax1, ax2) {
  const { openingSide, slotBounds, slotAxis, innerWallPos, openingPos } = slotInfo;
  const depthMid = (bounds3D.min[extrusionAxis] + bounds3D.max[extrusionAxis]) / 2;
  
  const polyBounds = {
    minX: Math.min(...polygon.map(p => p.x)),
    maxX: Math.max(...polygon.map(p => p.x)),
    minY: Math.min(...polygon.map(p => p.y)),
    maxY: Math.max(...polygon.map(p => p.y))
  };

  function mk3D(v1, v2) {
    const pt = {};
    pt[ax1] = v1; pt[ax2] = v2; pt[extrusionAxis] = depthMid;
    return { x: pt.x, y: pt.y, z: pt.z };
  }

  if (slotAxis === 'x') {
    // Jaws = top and bottom
    // Identifier la mâchoire longue via l'extension au-delà de la paroi intérieure
    const extDir = openingSide === 'left' ? 1 : -1;
    
    // Scanner les extensions de chaque mâchoire
    const topJawMaxX = findJawExtent(polygon, slotBounds.yMax, polyBounds.maxY, innerWallPos, extDir, 'y');
    const bottomJawMaxX = findJawExtent(polygon, polyBounds.minY, slotBounds.yMin, innerWallPos, extDir, 'y');
    
    const topExt = Math.abs(topJawMaxX - innerWallPos);
    const bottomExt = Math.abs(bottomJawMaxX - innerWallPos);
    
    // Trouver l'épaisseur de la paroi intérieure (côté extension)
    const innerWallOtherX = findInnerWallOtherFace(polygon, innerWallPos, 
      slotBounds.yMin, slotBounds.yMax, extDir, 'x');
    
    let longJawY, shortJawY, extStart, extEnd, jawIsAbove;
    if (topExt >= bottomExt) {
      longJawY = slotBounds.yMax;
      shortJawY = slotBounds.yMin;
      jawIsAbove = true;
      extStart = innerWallOtherX || innerWallPos;
      extEnd = topJawMaxX;
    } else {
      longJawY = slotBounds.yMin;
      shortJawY = slotBounds.yMax;
      jawIsAbove = false;
      extStart = innerWallOtherX || innerWallPos;
      extEnd = bottomJawMaxX;
    }

    const midExtX = (extStart + extEnd) / 2;
    
    // Point violet : trouver la surface RÉELLE de la mâchoire à midExtX
    // par ray casting vertical
    const purpleSurfaceY = findJawSurfaceAt(polygon, midExtX, longJawY, jawIsAbove);
    
    return {
      bluePoint: mk3D(openingPos, longJawY),
      greenPoint: mk3D(innerWallPos, longJawY),
      purplePoint: mk3D(midExtX, purpleSurfaceY),
      longJawSurface: longJawY,
      jawIsAbove
    };
  } else {
    // Vertical slot — same logic rotated
    const extDir = openingSide === 'bottom' ? 1 : -1;
    
    const rightJawMaxY = findJawExtent(polygon, slotBounds.xMax, polyBounds.maxX, innerWallPos, extDir, 'x');
    const leftJawMaxY = findJawExtent(polygon, polyBounds.minX, slotBounds.xMin, innerWallPos, extDir, 'x');
    
    const rightExt = Math.abs(rightJawMaxY - innerWallPos);
    const leftExt = Math.abs(leftJawMaxY - innerWallPos);
    
    const innerWallOtherY = findInnerWallOtherFace(polygon, innerWallPos, 
      slotBounds.xMin, slotBounds.xMax, extDir, 'y');
    
    let longJawX, shortJawX, extStart, extEnd, jawIsRight;
    if (rightExt >= leftExt) {
      longJawX = slotBounds.xMax;
      shortJawX = slotBounds.xMin;
      jawIsRight = true;
      extStart = innerWallOtherY || innerWallPos;
      extEnd = rightJawMaxY;
    } else {
      longJawX = slotBounds.xMin;
      shortJawX = slotBounds.xMax;
      jawIsRight = false;
      extStart = innerWallOtherY || innerWallPos;
      extEnd = leftJawMaxY;
    }

    const midExtY = (extStart + extEnd) / 2;
    const purpleSurfaceX = findJawSurfaceAt(polygon, midExtY, longJawX, jawIsRight, 'y');
    
    return {
      bluePoint: mk3D(longJawX, openingPos),
      greenPoint: mk3D(longJawX, innerWallPos),
      purplePoint: mk3D(purpleSurfaceX, midExtY),
      longJawSurface: longJawX,
      jawIsAbove: jawIsRight
    };
  }
}

/**
 * Trouve l'extension maximale d'une mâchoire dans la direction donnée.
 * jawYMin/jawYMax = étendue en Y de la mâchoire
 * innerWallPos = position de la paroi intérieure
 * extDir = +1 ou -1 (direction de l'extension)
 */
function findJawExtent(polygon, rangeMin, rangeMax, innerWallPos, extDir, scanAxis) {
  // Scanner la mâchoire avec des rayons pour trouver son extension maximale
  const NUM_SCAN = 50;
  const step = (rangeMax - rangeMin) / (NUM_SCAN + 1);
  let maxExtent = innerWallPos;
  
  for (let i = 1; i <= NUM_SCAN; i++) {
    const scanPos = rangeMin + i * step;
    let intersections;
    
    if (scanAxis === 'y') {
      // Scan en Y, cherche extension en X
      intersections = rayIntersectsPolygonX(scanPos, polygon);
    } else {
      // Scan en X, cherche extension en Y
      intersections = rayIntersectsPolygonY(scanPos, polygon);
    }
    
    if (intersections.length >= 2) {
      const extent = extDir > 0 
        ? Math.max(...intersections) 
        : Math.min(...intersections);
      
      if (extDir > 0 ? extent > maxExtent : extent < maxExtent) {
        maxExtent = extent;
      }
    }
  }
  
  return maxExtent;
}

/**
 * Trouve l'autre face de la paroi intérieure.
 * On utilise un seuil minimal pour ne pas confondre les deux côtés de la même surface
 * (l'imprécision du scan peut donner wallPos légèrement décalé).
 */
function findInnerWallOtherFace(polygon, wallPos, rangeMin, rangeMax, extDir, axis) {
  const mid = (rangeMin + rangeMax) / 2;
  let intersections;
  
  if (axis === 'x') {
    intersections = rayIntersectsPolygonX(mid, polygon);
  } else {
    intersections = rayIntersectsPolygonY(mid, polygon);
  }
  
  // Seuil minimal : ne pas confondre la même surface (1mm minimum)
  const MIN_WALL_THICKNESS = 1.0;
  const candidates = intersections.filter(v => {
    const diff = v - wallPos;
    return extDir > 0 ? diff > MIN_WALL_THICKNESS : diff < -MIN_WALL_THICKNESS;
  });
  
  if (candidates.length > 0) {
    return extDir > 0 ? Math.min(...candidates) : Math.max(...candidates);
  }
  return null;
}

/**
 * Trouve la surface réelle de la mâchoire à une position X donnée.
 * 
 * Pour le point violet, on ne peut pas utiliser le Y de la surface dans la fente
 * car au-delà de la paroi intérieure, la mâchoire peut avoir une forme différente
 * (angle, courbe, etc). On lance un rayon vertical à la position X et on prend
 * la surface la plus proche du slot.
 * 
 * @param {Array} polygon - contour 2D
 * @param {number} posX - position X où chercher la surface (ou Y si scanAxis='y')
 * @param {number} refSurface - Y de référence (surface dans la fente)
 * @param {boolean} jawIsAbove - la mâchoire longue est-elle au-dessus de la fente?
 * @param {string} scanAxis - 'x' (default) pour rayon vertical, 'y' pour horizontal
 */
function findJawSurfaceAt(polygon, posX, refSurface, jawIsAbove, scanAxis = 'x') {
  let intersections;
  
  if (scanAxis === 'x') {
    // Rayon vertical à X=posX → trouver les Y
    intersections = rayIntersectsPolygonY(posX, polygon);
  } else {
    // Rayon horizontal à Y=posX → trouver les X
    intersections = rayIntersectsPolygonX(posX, polygon);
  }
  
  if (intersections.length < 2) return refSurface; // fallback
  
  // La surface côté fente est :
  // - jawIsAbove=true → la plus BASSE intersection (max Y en SVG = min Y en modèle quand flippé,
  //   mais en coordonnées modèle : c'est le MIN du segment le plus haut)
  //   Non, plus simple : c'est l'intersection la plus proche de refSurface
  //   côté fente (vers le centre de la fente)
  
  // On cherche parmi les bords de segments solides celui qui fait face à la fente
  // Les intersections sont par paires [enter, exit, enter, exit, ...]
  // Pour un jawIsAbove (mâchoire en haut), la surface est le MIN Y du segment le plus haut
  // Pour un jawIsBelow (mâchoire en bas), la surface est le MAX Y du segment le plus bas
  
  if (jawIsAbove) {
    // Mâchoire en haut → sa surface inférieure = le MIN Y du dernier segment
    // Le dernier segment est le plus haut en Y
    return intersections[intersections.length - 2]; // avant-dernière = entrée du dernier segment
  } else {
    // Mâchoire en bas → sa surface supérieure = le MAX Y du premier segment
    return intersections[1]; // deuxième = sortie du premier segment
  }
}

// ===========================================================================
// ORIENTATION
// ===========================================================================

function computeOrientation(keyPoints, bounds3D, extrusionAxis, slotInfo) {
  const { bluePoint, greenPoint, purplePoint, longJawSurface } = keyPoints;

  const center = {
    x: round((bounds3D.min.x + bounds3D.max.x) / 2),
    y: round((bounds3D.min.y + bounds3D.max.y) / 2),
    z: round((bounds3D.min.z + bounds3D.max.z) / 2)
  };

  function sub(a, b) { return { x: a.x-b.x, y: a.y-b.y, z: a.z-b.z }; }
  function normalize(v) {
    const len = Math.sqrt(v.x*v.x + v.y*v.y + v.z*v.z);
    if (len < EPSILON) return { x:0, y:0, z:0 };
    return { x: round(v.x/len,4), y: round(v.y/len,4), z: round(v.z/len,4) };
  }

  const slotDirection = normalize(sub(bluePoint, greenPoint));
  const bagDirection = normalize(sub(purplePoint, greenPoint));
  const depthDirection = { x: 0, y: 0, z: 0 };
  depthDirection[extrusionAxis] = 1;

  // jawNormal : perpendiculaire à la mâchoire longue, pointe vers l'intérieur de la fente
  let jawNormal = { x: 0, y: 0, z: 0 };
  if (slotInfo.slotAxis === 'x') {
    const axes = ['x','y','z'].filter(a => a !== extrusionAxis);
    const slotCenterY = (slotInfo.slotBounds.yMin + slotInfo.slotBounds.yMax) / 2;
    jawNormal[axes[1]] = longJawSurface > slotCenterY ? -1 : 1;
  } else {
    const axes = ['x','y','z'].filter(a => a !== extrusionAxis);
    const slotCenterX = (slotInfo.slotBounds.xMin + slotInfo.slotBounds.xMax) / 2;
    jawNormal[axes[0]] = longJawSurface > slotCenterX ? -1 : 1;
  }

  // Matrice de transformation canonique
  // Aligne : bagDirection → +X, jawNormal → +Y, depth → +Z
  // ALIGNEMENT SUR LE POINT VERT (greenPoint) et non le centre géométrique
  const canonicalTransform = {
    description: "Matrice 3x3 : bagDirection→+X, jawNormal→+Y, depth→+Z. " +
                 "Aligné sur greenPoint. Usage: newPt = matrix * (oldPt - greenPoint) + targetOrigin",
    matrix: [
      [bagDirection.x, bagDirection.y, bagDirection.z],
      [jawNormal.x, jawNormal.y, jawNormal.z],
      [depthDirection.x, depthDirection.y, depthDirection.z]
    ],
    origin: roundPt(greenPoint)
  };

  return {
    center,
    slotDirection: roundPt(slotDirection),
    bagDirection: roundPt(bagDirection),
    depthDirection: roundPt(depthDirection),
    jawNormal: roundPt(jawNormal),
    canonicalTransform
  };
}

// ===========================================================================
// ===========================================================================
// MAIN API
// ===========================================================================

function analyzeBuffer(arrayBuffer, fileName = 'unknown') {
  try {
    const { triangles, bounds } = parseSTL(arrayBuffer);
    if (triangles.length === 0) return { success: false, error: 'Fichier STL vide.', fileName };

    const extrusionAxis = detectExtrusionAxis(bounds, triangles);
    const { polygon, ax1, ax2 } = extractCrossSection(triangles, bounds, extrusionAxis);
    if (polygon.length < 4) return { success: false, error: 'Contour insuffisant.', fileName };

    const polyBounds = {
      minX: Math.min(...polygon.map(p=>p.x)), maxX: Math.max(...polygon.map(p=>p.x)),
      minY: Math.min(...polygon.map(p=>p.y)), maxY: Math.max(...polygon.map(p=>p.y))
    };

    const rawSlot = detectSlotRobust(polygon);
    const slotInfo = processSlotResult(rawSlot, polygon, polyBounds);
    const kp = computeKeyPoints(polygon, slotInfo, bounds, extrusionAxis, ax1, ax2);
    const orient = computeOrientation(kp, bounds, extrusionAxis, slotInfo);

    return {
      success: true, fileName,
      bounds: { min: roundPt(bounds.min), max: roundPt(bounds.max) },
      dimensions: {
        x: round(bounds.max.x - bounds.min.x),
        y: round(bounds.max.y - bounds.min.y),
        z: round(bounds.max.z - bounds.min.z)
      },
      extrusionAxis,
      openingSide: slotInfo.openingSide,
      slotHeight: round(slotInfo.slotHeight),
      slotDepth: round(slotInfo.slotDepth),
      bluePoint: roundPt(kp.bluePoint),
      greenPoint: roundPt(kp.greenPoint),
      purplePoint: roundPt(kp.purplePoint),
      jawIsAbove: kp.jawIsAbove,
      orientation: orient,
      crossSection: {
        axes: [ax1, ax2],
        polygon: polygon.map(p => ({ x: round(p.x), y: round(p.y) })),
        slotBounds: {
          xMin: round(slotInfo.slotBounds.xMin),
          xMax: round(slotInfo.slotBounds.xMax),
          yMin: round(slotInfo.slotBounds.yMin),
          yMax: round(slotInfo.slotBounds.yMax)
        }
      }
    };
  } catch (err) {
    return { success: false, error: err.message, fileName };
  }
}

function analyzeBatchBuffers(items) { return items.map(i => analyzeBuffer(i.buffer, i.name)); }

// Browser export
window.STLBackpackAnalyzer = {
  analyzeBuffer, analyzeBatchBuffers,
  parseSTL, extractCrossSection, detectSlotRobust, detectExtrusionAxis, computeKeyPoints
};
