/**
 * SectionEngine — moteur unique du simulateur ET du correcteur.
 * =============================================================
 *
 * Tout est calculé sur la COUPE 2D du support (profil extrudé), dans un repère
 * canonique unique. Pas de placement 3D, pas de raycasting, pas d'Euler à
 * arrondir : la géométrie est exacte et reproductible, donc le correcteur et le
 * simulateur donnent toujours le même chiffre.
 *
 * Repère canonique (= ce qui est dessiné) :
 *   - la TABLE occupe x ≤ 0, y ∈ [0, T]   (T = épaisseur réelle de la table)
 *   - le fond de la fente du support est plaqué contre le chant de la table (x = 0)
 *   - la fente s'ouvre vers −x, la mâchoire longue porte le bras vers +x
 *   - le sac tire vers −y au bout du bras
 *
 * Chaîne de calcul :
 *   1. STL            → triangles
 *   2. axe d'extrusion → coupe 2D (contour + trous)
 *   3. balayage de rayons → fente (candidats notés, pas de "premier trouvé")
 *   4. repère canonique (permutation signée d'axes : exact, sans distorsion)
 *   5. insertion : la table se coince dans la fente → angle de basculement θ
 *   6. flexion (Euler-Bernoulli) sur le bras libre → poids maximum
 *
 * API :
 *   SectionEngine.analyze(arrayBuffer, { tableThickness, material })
 *   SectionEngine.renderSVG(result, { width, height })
 */
(function (global) {
'use strict';

var GRAVITY = 9.81;

// Matériau par défaut : PLA imprimé 3D.
// yield = limite élastique du filament (MPa), k = abattement pour l'impression
// (adhérence entre couches, remplissage partiel, défauts) → contrainte admissible
// = yield × k = 20 MPa. C'EST LE BOUTON DE CALIBRATION du barème : le baisser
// rend l'épreuve plus sévère, le monter la rend plus indulgente.
var DEFAULT_MATERIAL = { name: 'PLA', yield: 50, E: 3500, k: 0.4 };

// ===========================================================================
// 1. STL
// ===========================================================================

function parseSTL(arrayBuffer) {
    var bytes = new Uint8Array(arrayBuffer);
    var head = new TextDecoder('ascii').decode(bytes.slice(0, Math.min(300, bytes.length)));
    if (head.trim().indexOf('solid') === 0 && head.indexOf('facet') !== -1) {
        return parseAscii(new TextDecoder('ascii').decode(bytes));
    }
    return parseBinary(arrayBuffer);
}

function parseBinary(arrayBuffer) {
    var dv = new DataView(arrayBuffer);
    var n = dv.getUint32(80, true);
    // Garde-fou : un en-tête corrompu peut annoncer des millions de triangles.
    var expected = 84 + n * 50;
    if (n <= 0 || expected > arrayBuffer.byteLength + 4) {
        throw new Error('Fichier STL binaire invalide (' + n + ' triangles annoncés).');
    }
    var tris = [], b = newBounds(), off = 84;
    for (var i = 0; i < n; i++) {
        off += 12; // normale ignorée : on la recalcule si besoin
        var v = [];
        for (var k = 0; k < 3; k++) {
            var p = { x: dv.getFloat32(off, true), y: dv.getFloat32(off + 4, true), z: dv.getFloat32(off + 8, true) };
            off += 12;
            v.push(p); grow(b, p);
        }
        off += 2;
        tris.push(v);
    }
    return { triangles: tris, bounds: b };
}

function parseAscii(text) {
    var tris = [], b = newBounds();
    var re = /vertex\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)/g, m, buf = [];
    while ((m = re.exec(text)) !== null) {
        var p = { x: +m[1], y: +m[2], z: +m[3] };
        grow(b, p); buf.push(p);
        if (buf.length === 3) { tris.push(buf); buf = []; }
    }
    return { triangles: tris, bounds: b };
}

function newBounds() {
    return { min: { x: Infinity, y: Infinity, z: Infinity }, max: { x: -Infinity, y: -Infinity, z: -Infinity } };
}
function grow(b, v) {
    if (v.x < b.min.x) b.min.x = v.x; if (v.x > b.max.x) b.max.x = v.x;
    if (v.y < b.min.y) b.min.y = v.y; if (v.y > b.max.y) b.max.y = v.y;
    if (v.z < b.min.z) b.min.z = v.z; if (v.z > b.max.z) b.max.z = v.z;
}

// ===========================================================================
// 2. COUPE 2D
// ===========================================================================

/**
 * Axe d'extrusion : celui qui porte le MOINS de valeurs distinctes.
 * Un profil extrudé n'a que 2 plans de faces le long de son extrusion,
 * alors que les deux autres axes portent tous les sommets du contour.
 */
function rankExtrusionAxes(triangles, bounds) {
    var axes = ['x', 'y', 'z'], out = [];
    for (var a = 0; a < 3; a++) {
        var ax = axes[a], set = {};
        for (var i = 0; i < triangles.length; i++) {
            var t = triangles[i];
            for (var k = 0; k < 3; k++) set[Math.round(t[k][ax] * 100)] = 1;
        }
        out.push({ axis: ax, distinct: Object.keys(set).length, size: bounds.max[ax] - bounds.min[ax] });
    }
    out.sort(function (p, q) { return p.distinct - q.distinct; });
    return out;
}

/** Intersection du maillage avec un plan ⟂ axis à la cote pos → segments 2D. */
function sliceTriangles(triangles, axis, pos, a1, a2) {
    var segs = [];
    for (var i = 0; i < triangles.length; i++) {
        var v = triangles[i];
        var d0 = v[0][axis] - pos, d1 = v[1][axis] - pos, d2 = v[2][axis] - pos;
        var d = [d0, d1, d2];
        var above = (d0 > 0) + (d1 > 0) + (d2 > 0);
        if (above === 0 || above === 3) continue; // pas de traversée
        var pts = [];
        for (var e = 0; e < 3; e++) {
            var j = (e + 1) % 3;
            if ((d[e] > 0) !== (d[j] > 0)) {
                var t = d[e] / (d[e] - d[j]);
                pts.push({
                    x: v[e][a1] + t * (v[j][a1] - v[e][a1]),
                    y: v[e][a2] + t * (v[j][a2] - v[e][a2])
                });
            }
        }
        if (pts.length === 2) segs.push([pts[0], pts[1]]);
    }
    return segs;
}

/**
 * Recolle les segments en boucles fermées (contour extérieur + trous).
 * Les sommets STL sont en float32 : deux triangles voisins ne redonnent pas
 * exactement le même point d'intersection. On cherche donc le point le plus
 * proche dans un voisinage, et non une clé de hachage exacte — sinon une boucle
 * se casse en morceaux et toute la détection de fente part de travers.
 */
function chainLoops(segs, tol) {
    var cell = Math.max(tol, 1e-6);
    var grid = {};
    function cellKey(x, y) { return Math.floor(x / cell) + '_' + Math.floor(y / cell); }
    for (var i = 0; i < segs.length; i++) {
        for (var e = 0; e < 2; e++) {
            var p = segs[i][e], k = cellKey(p.x, p.y);
            (grid[k] || (grid[k] = [])).push({ seg: i, end: e });
        }
    }
    function nearestFree(p, used, skipSeg) {
        var cx = Math.floor(p.x / cell), cy = Math.floor(p.y / cell);
        var best = null, bestD = tol * tol;
        for (var dx = -1; dx <= 1; dx++) for (var dy = -1; dy <= 1; dy++) {
            var list = grid[(cx + dx) + '_' + (cy + dy)];
            if (!list) continue;
            for (var n = 0; n < list.length; n++) {
                var it = list[n];
                if (used[it.seg] || it.seg === skipSeg) continue;
                var q = segs[it.seg][it.end];
                var d = (q.x - p.x) * (q.x - p.x) + (q.y - p.y) * (q.y - p.y);
                if (d <= bestD) { bestD = d; best = it; }
            }
        }
        return best;
    }

    var used = new Array(segs.length).fill(false), loops = [];
    for (var s = 0; s < segs.length; s++) {
        if (used[s]) continue;
        used[s] = true;
        var loop = [segs[s][0], segs[s][1]];
        for (var guard = 0; guard < segs.length + 2; guard++) {
            var last = loop[loop.length - 1];
            var nxt = nearestFree(last, used, -1);
            if (!nxt) break;
            used[nxt.seg] = true;
            loop.push(segs[nxt.seg][1 - nxt.end]);
        }
        if (loop.length >= 4) {
            var a = loop[0], z = loop[loop.length - 1];
            if (Math.hypot(z.x - a.x, z.y - a.y) <= tol) loop.pop();
            loops.push(loop);
        }
    }
    return loops;
}

function signedArea(loop) {
    var a = 0;
    for (var i = 0, j = loop.length - 1; i < loop.length; j = i++) {
        a += (loop[j].x * loop[i].y - loop[i].x * loop[j].y);
    }
    return a / 2;
}

function loopsBounds(loops) {
    var b = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
    for (var i = 0; i < loops.length; i++) for (var j = 0; j < loops[i].length; j++) {
        var p = loops[i][j];
        if (p.x < b.minX) b.minX = p.x; if (p.x > b.maxX) b.maxX = p.x;
        if (p.y < b.minY) b.minY = p.y; if (p.y > b.maxY) b.maxY = p.y;
    }
    return b;
}

/**
 * Coupe le modèle à plusieurs profondeurs et retient la tranche MÉDIANE en aire.
 * Une tranche prise au hasard peut tomber sur une gravure, un chanfrein ou un
 * congé de bout : la médiane donne le vrai profil, et la dispersion des aires
 * dit si la pièce est réellement extrudée.
 */
function extractSection(triangles, bounds, axis) {
    var others = ['x', 'y', 'z'].filter(function (a) { return a !== axis; });
    var a1 = others[0], a2 = others[1];
    var lo = bounds.min[axis], hi = bounds.max[axis], span = hi - lo;
    var tol = Math.max(0.02, span * 1e-3);   // tolérance de recollement des contours
    var cuts = [0.3, 0.4, 0.5, 0.6, 0.7], slices = [];

    for (var i = 0; i < cuts.length; i++) {
        var segs = sliceTriangles(triangles, axis, lo + span * cuts[i], a1, a2);
        if (segs.length < 3) continue;
        var loops = chainLoops(segs, tol).filter(function (l) { return l.length >= 3 && Math.abs(signedArea(l)) > 0.5; });
        if (!loops.length) continue;
        var area = 0;
        for (var l = 0; l < loops.length; l++) area += Math.abs(signedArea(loops[l]));
        slices.push({ loops: loops, area: area, at: cuts[i] });
    }
    if (!slices.length) throw new Error("Impossible d'extraire la coupe 2D du modèle.");

    slices.sort(function (p, q) { return p.area - q.area; });
    var median = slices[Math.floor(slices.length / 2)];
    var spread = slices.length > 1 ? (slices[slices.length - 1].area - slices[0].area) / median.area : 0;

    return {
        loops: median.loops,
        axes: [a1, a2],
        depth: span,
        areaSpread: spread,
        constantSection: spread < 0.08
    };
}

// ===========================================================================
// 3. DÉTECTION DE LA FENTE
// ===========================================================================

/** Croisements triés d'un rayon avec toutes les boucles. axis='x' → rayon vertical. */
function crossings(loops, axis, pos) {
    var out = [];
    for (var i = 0; i < loops.length; i++) {
        var loop = loops[i], n = loop.length;
        for (var a = 0, b = n - 1; a < n; b = a++) {
            var p = loop[b], q = loop[a];
            if (axis === 'x') {
                if ((p.x > pos) !== (q.x > pos)) out.push(p.y + (pos - p.x) * (q.y - p.y) / (q.x - p.x));
            } else {
                if ((p.y > pos) !== (q.y > pos)) out.push(p.x + (pos - p.y) * (q.x - p.x) / (q.y - p.y));
            }
        }
    }
    out.sort(function (u, v) { return u - v; });
    return out;
}

/** Intervalles de MATIÈRE traversés par le rayon (règle pair/impair). */
function solidSpans(loops, axis, pos, minWidth) {
    var c = crossings(loops, axis, pos), out = [];
    for (var i = 0; i + 1 < c.length; i += 2) {
        if (c[i + 1] - c[i] > (minWidth || 0.05)) out.push([c[i], c[i + 1]]);
    }
    return out;
}

/** Intervalles de VIDE entre deux blocs de matière (fente, trou). */
function gapSpans(loops, axis, pos, minWidth) {
    var c = crossings(loops, axis, pos), out = [];
    for (var i = 1; i + 1 < c.length; i += 2) {
        if (c[i + 1] - c[i] > (minWidth || 0.5)) out.push([c[i], c[i + 1]]);
    }
    return out;
}

/**
 * Cherche les "canaux" : bandes de vide continues le long d'un axe de balayage.
 * Un canal qui débouche sur UN seul bord de la pièce est une fente ;
 * un canal fermé des deux côtés est un trou décoratif (ignoré).
 */
function findChannels(loops, scanAxis, bounds) {
    var lo, hi;
    if (scanAxis === 'x') { lo = bounds.minX; hi = bounds.maxX; }
    else { lo = bounds.minY; hi = bounds.maxY; }
    var N = 300, step = (hi - lo) / (N + 1), channels = [];

    for (var i = 1; i <= N; i++) {
        var pos = lo + i * step;
        var gaps = gapSpans(loops, scanAxis, pos, 0.8);
        var open = channels.filter(function (c) { return c.lastIdx === i - 1; });
        var matched = [];
        for (var g = 0; g < gaps.length; g++) {
            var gp = gaps[g], best = null, bestOv = 0;
            for (var c2 = 0; c2 < open.length; c2++) {
                var ch = open[c2];
                if (matched.indexOf(ch) !== -1) continue;
                var ov = Math.min(gp[1], ch.lastSpan[1]) - Math.max(gp[0], ch.lastSpan[0]);
                if (ov > bestOv) { bestOv = ov; best = ch; }
            }
            // continuité : il faut un vrai recouvrement (≥ 40 % du vide courant)
            if (best && bestOv > 0.4 * (gp[1] - gp[0])) {
                best.samples.push({ pos: pos, span: gp });
                best.lastIdx = i; best.lastSpan = gp; best.end = pos;
                matched.push(best);
            } else {
                channels.push({
                    samples: [{ pos: pos, span: gp }],
                    start: pos, end: pos, lastIdx: i, lastSpan: gp,
                    startsAtEdge: (i <= 2)
                });
            }
        }
    }

    // Un canal DÉBOUCHE si, juste au-delà de son extrémité, le vide continue —
    // c'est-à-dire s'il n'y a pas de matière en face. Comparer la position au
    // bord de la boîte englobante ne marche pas : une mâchoire est souvent un
    // peu plus longue que l'autre, et la bouche est alors en retrait.
    for (var k = 0; k < channels.length; k++) {
        var ch2 = channels[k];
        var w = ch2.samples.map(function (s) { return s.span[1] - s.span[0]; }).sort(function (a, b) { return a - b; });
        ch2.height = w[Math.floor(w.length / 2)];        // hauteur médiane du vide
        ch2.length = ch2.end - ch2.start;                 // longueur du canal
        var mids = ch2.samples.map(function (s) { return (s.span[0] + s.span[1]) / 2; }).sort(function (a, b) { return a - b; });
        ch2.mid = mids[Math.floor(mids.length / 2)];
        ch2.opensLow = !inMaterial(loops, scanAxis, ch2.start - 2 * step, ch2.mid);
        ch2.opensHigh = !inMaterial(loops, scanAxis, ch2.end + 2 * step, ch2.mid);
    }
    return channels;
}

/** Point dans la matière ? (règle pair/impair sur toutes les boucles) */
function insideLoops(loops, x, y) {
    var inside = false;
    for (var i = 0; i < loops.length; i++) {
        var loop = loops[i], n = loop.length;
        for (var a = 0, b = n - 1; a < n; b = a++) {
            var pa = loop[a], pb = loop[b];
            if ((pa.y > y) !== (pb.y > y) &&
                x < (pb.x - pa.x) * (y - pa.y) / (pb.y - pa.y) + pa.x) inside = !inside;
        }
    }
    return inside;
}

/** Le point (pos le long du balayage, cross en travers) est-il dans la matière ? */
function inMaterial(loops, scanAxis, pos, cross) {
    var spans = solidSpans(loops, scanAxis, pos, 0.05);
    for (var i = 0; i < spans.length; i++) {
        if (cross >= spans[i][0] && cross <= spans[i][1]) return true;
    }
    return false;
}

/**
 * Note chaque canal débouchant et retient la meilleure fente.
 * Critères : elle doit déboucher d'un seul côté, avoir une hauteur plausible,
 * une vraie profondeur de prise, et surtout un BRAS qui dépasse au-delà du fond
 * (sans bras, ce n'est pas un support de sac).
 */
function detectSlot(loops, bounds) {
    var cands = [];
    [['x', 'horizontal'], ['y', 'vertical']].forEach(function (mode) {
        var scanAxis = mode[0];
        findChannels(loops, scanAxis, bounds).forEach(function (ch) {
            if (ch.opensLow === ch.opensHigh) return;   // traversant ou fermé → pas une fente
            if (ch.length < 3 || ch.height < 2) return;

            // scanAxis 'x' : rayons verticaux, le canal court en x
            //   → la fente s'ouvre selon x, sa hauteur se mesure en y.
            var openLow = ch.opensLow;
            var mouth = openLow ? ch.start : ch.end;      // bouche de la fente
            var wall = openLow ? ch.end : ch.start;       // fond de la fente
            var grip = Math.abs(wall - mouth);
            var armDir = openLow ? +1 : -1;               // le bras part du côté opposé à la bouche

            // Longueur du bras : matière au-delà du fond, dans la direction du bras.
            var far = armDir > 0
                ? (scanAxis === 'x' ? bounds.maxX : bounds.maxY)
                : (scanAxis === 'x' ? bounds.minX : bounds.minY);
            var arm = Math.abs(far - wall);

            var score = 0;
            score += Math.min(grip, 60) * 1.5;
            score += Math.min(arm, 60) * 1.5;
            if (ch.height >= 12 && ch.height <= 32) score += 60;      // ordre de grandeur d'un plateau
            else if (ch.height >= 6 && ch.height <= 45) score += 20;
            else score -= 40;
            if (arm < 5) score -= 120;                                 // pas de bras → pas un support
            if (grip < 5) score -= 60;

            cands.push({
                scanAxis: scanAxis, slotAxis: scanAxis,   // axe le long duquel la fente s'enfonce
                mouth: mouth, wall: wall, grip: grip, arm: arm, armDir: armDir,
                height: ch.height, mid: ch.mid, score: score, channel: ch
            });
        });
    });
    if (!cands.length) throw new Error('Aucune fente débouchante détectée dans la coupe.');
    cands.sort(function (a, b) { return b.score - a.score; });
    return { best: cands[0], all: cands };
}

/** Affine bouche / fond / hauteur par dichotomie autour du résultat du balayage. */
function refineSlot(loops, slot, bounds) {
    var axis = slot.scanAxis;
    var lo = axis === 'x' ? bounds.minX : bounds.minY;
    var hi = axis === 'x' ? bounds.maxX : bounds.maxY;

    function hasGap(pos) {
        var gaps = gapSpans(loops, axis, pos, 0.5);
        for (var i = 0; i < gaps.length; i++) {
            var m = (gaps[i][0] + gaps[i][1]) / 2;
            if (Math.abs(m - slot.mid) < slot.height) return true;
        }
        return false;
    }
    function bisect(a, b) {           // a : sans fente, b : avec fente
        for (var i = 0; i < 30; i++) {
            var m = (a + b) / 2;
            if (hasGap(m)) b = m; else a = m;
        }
        return (a + b) / 2;
    }

    var inward = slot.armDir;         // du fond vers... (bouche = côté opposé au bras)
    // bouche : dernière position (côté bord) où la fente existe encore
    var mouth = inward > 0 ? bisect(lo - 1, slot.mouth + (slot.grip * 0.1))
                           : bisect(hi + 1, slot.mouth - (slot.grip * 0.1));
    // fond : première position au-delà de laquelle la fente disparaît
    var wall = inward > 0 ? bisect(hi + 1, slot.wall - (slot.grip * 0.1))
                          : bisect(lo - 1, slot.wall + (slot.grip * 0.1));

    // Garde-fou : la dichotomie suppose une seule transition. Si la pièce en
    // présente plusieurs (décor, second évidement), le résultat part au loin —
    // dans ce cas on garde la valeur du balayage, moins précise mais sûre.
    var maxDrift = Math.max(2, slot.grip * 0.25);
    if (Math.abs(mouth - slot.mouth) > maxDrift) mouth = slot.mouth;
    if (Math.abs(wall - slot.wall) > maxDrift) wall = slot.wall;

    // hauteur mesurée au milieu de la prise (à l'écart des chanfreins d'entrée)
    var mid = (mouth + wall) / 2;
    var gaps = gapSpans(loops, axis, mid, 0.5), span = null;
    for (var i = 0; i < gaps.length; i++) {
        if (Math.abs((gaps[i][0] + gaps[i][1]) / 2 - slot.mid) < slot.height) span = gaps[i];
    }
    if (span) {
        slot.height = span[1] - span[0];
        slot.spanLow = span[0]; slot.spanHigh = span[1];
    } else {
        slot.spanLow = slot.mid - slot.height / 2;
        slot.spanHigh = slot.mid + slot.height / 2;
    }
    slot.mouth = mouth; slot.wall = wall;
    slot.grip = Math.abs(wall - mouth);
    return slot;
}

// ===========================================================================
// 4. REPÈRE CANONIQUE
// ===========================================================================

/**
 * Transforme la coupe dans le repère de travail par une simple permutation
 * signée d'axes (exacte, réversible, sans distorsion ni angle d'Euler) :
 *   origine = fond de fente × surface de la mâchoire longue
 *   +x = vers le bras   ·   +y = vers l'intérieur de la fente
 */
function canonicalize(loops, slot, bounds) {
    // Quelle mâchoire porte le bras ? Celle qui s'étend le plus loin au-delà du fond.
    var axis = slot.scanAxis;                     // axe le long duquel la fente s'enfonce
    var cross = axis === 'x' ? 'y' : 'x';         // axe de la hauteur de fente
    var lowExt = jawExtent(loops, slot, cross, false);
    var highExt = jawExtent(loops, slot, cross, true);
    var longIsHigh = highExt > lowExt;

    // Surface de la mâchoire longue côté fente → deviendra y = 0.
    var jawSurface = longIsHigh ? slot.spanHigh : slot.spanLow;
    var sx = slot.armDir;                          // +1 : le bras est vers les valeurs croissantes
    var sy = longIsHigh ? -1 : +1;                 // l'intérieur de la fente part de la mâchoire longue

    var ox = slot.wall, oy = jawSurface;

    function map(p) {
        var u = axis === 'x' ? p.x : p.y;          // le long de la fente
        var v = axis === 'x' ? p.y : p.x;          // la hauteur de fente
        return { x: sx * (u - ox), y: sy * (v - oy) };
    }

    var out = loops.map(function (l) { return l.map(map); });
    // Une permutation impaire inverse le sens des boucles : on les remet à l'endroit
    // pour que le contour extérieur reste en sens direct.
    return {
        loops: out,
        slotHeight: slot.height,
        grip: slot.grip,
        armExtent: longIsHigh ? highExt : lowExt,
        map: map
    };
}

/**
 * Jusqu'où la mâchoire (haute ou basse) s'étend-elle au-delà du fond de fente ?
 * On tire des rayons PARALLÈLES à la fente, juste derrière la surface de la
 * mâchoire, et on regarde jusqu'où va la matière au-delà du fond.
 */
function jawExtent(loops, slot, cross, high) {
    var y0 = high ? slot.spanHigh : slot.spanLow;
    var far = 0;
    for (var t = 0.5; t <= 6; t += 0.5) {
        var pos = high ? y0 + t : y0 - t;
        // rayon à coordonnée transverse constante → intervalles le long de la fente
        var spans = solidSpans(loops, cross, pos, 0.3);
        for (var i = 0; i < spans.length; i++) {
            var d = slot.armDir > 0 ? spans[i][1] - slot.wall : slot.wall - spans[i][0];
            if (d > far) far = d;
        }
    }
    return far;
}

// ===========================================================================
// 5. INSERTION DANS LA TABLE
// ===========================================================================

/**
 * La table (épaisseur T) se coince dans la fente (hauteur S, prise G).
 * Le support bascule jusqu'à porter sur deux points :
 *   - le fond de la mâchoire longue sous la table
 *   - la lèvre de la mâchoire courte sur le dessus de la table
 * D'où la condition de coincement :   S·cos θ − G·sin θ = T
 * θ = 0 quand la fente est pile à l'épaisseur de la table ; θ grandit avec le jeu.
 */
function computeTilt(S, G, T, tol) {
    T = T - (tol || 0);                      // tolérance d'ajustement (mesure + impression)
    if (S < T) return { fits: false, theta: 0, reason: 'tooSmall' };
    var R = Math.hypot(S, G);
    if (T > R) return { fits: false, theta: 0, reason: 'tooSmall' };
    var theta = Math.acos(T / R) - Math.atan2(G, S);
    if (!isFinite(theta) || theta < 0) theta = 0;
    // Au-delà, la table ressort de la fente : le support décroche.
    var slips = theta > 35 * Math.PI / 180;
    return { fits: true, theta: theta, slips: slips, reason: slips ? 'slips' : 'ok' };
}

function rotatePoint(p, c, s, tx, ty) {
    return { x: p.x * c + p.y * s + tx, y: -p.x * s + p.y * c + ty };
}

/** Place le support basculé contre la table et renvoie la coupe en repère monde. */
function placeOnTable(canon, T, tol) {
    var S = canon.slotHeight, G = canon.grip;
    var tilt = computeTilt(S, G, T, tol);
    var th = tilt.fits ? tilt.theta : 0;
    var c = Math.cos(th), s = Math.sin(th);

    // rotation horaire de θ ; le fond de la mâchoire longue (−G, 0) revient sur y = 0
    var ty = -G * s;

    // Glissement horizontal : une fois basculé, le fond de la fente viendrait
    // mordre dans le chant de la table. On recule le support du strict minimum
    // pour que le chant (x = 0, y de 0 à T) ne soit plus dans la matière.
    // Si la fente est trop petite, on le laisse à sa place d'insertion théorique :
    // le chevauchement avec la table EST justement l'information à montrer.
    var edge = [];
    for (var e = 1; e < 24; e++) edge.push(T * e / 24);   // le chant, hors coins exacts

    function edgeClear(shift) {
        for (var i = 0; i < edge.length; i++) {
            // point du chant de la table ramené dans le repère du support
            var dx = -shift, dy = edge[i] - ty;
            if (insideLoops(canon.loops, dx * c - dy * s, dx * s + dy * c)) return false;
        }
        return true;
    }

    var tx = 0;
    if (tilt.fits && !edgeClear(0)) {
        var lo = 0, hi = G + 2;
        for (var it = 0; it < 26; it++) {
            var mid = (lo + hi) / 2;
            if (edgeClear(mid)) hi = mid; else lo = mid;
        }
        tx = hi;
    }

    var world = canon.loops.map(function (loop) {
        return loop.map(function (p) { return rotatePoint(p, c, s, tx, ty); });
    });

    return {
        loops: world, theta: th, tilt: tilt,
        tableThickness: T,
        // zone où la table et le support se chevauchent quand la fente est trop petite
        interference: tilt.fits ? null : { xMin: -G, xMax: 0, yMin: S, yMax: T },
        contacts: [
            rotatePoint({ x: -G, y: 0 }, c, s, tx, ty),
            rotatePoint({ x: 0, y: S }, c, s, tx, ty)
        ]
    };
}

// ===========================================================================
// 6. RÉSISTANCE — flexion du bras libre
// ===========================================================================

/**
 * Repère les ENTAILLES : les angles rentrants du contour, là où la contrainte
 * se concentre. Un congé est maillé en petits pas réguliers (rayon = pas / angle),
 * alors qu'une arête vive est un seul sommet qui tourne d'un coup — rayon nul.
 * Les angles sortants (coins extérieurs) ne concentrent rien : on les ignore.
 */
function filletRadii(loops) {
    var pts = [];
    for (var i = 0; i < loops.length; i++) {
        var loop = loops[i], n = loop.length;
        if (n < 3) continue;
        var sgn = signedArea(loop) >= 0 ? 1 : -1;       // sens de parcours
        for (var j = 0; j < n; j++) {
            var prev = loop[(j - 1 + n) % n], cur = loop[j], next = loop[(j + 1) % n];
            var l1 = Math.hypot(cur.x - prev.x, cur.y - prev.y);
            var l2 = Math.hypot(next.x - cur.x, next.y - cur.y);
            if (l1 < 1e-6 || l2 < 1e-6) continue;
            var turn = normAngle(Math.atan2(next.y - cur.y, next.x - cur.x) -
                                 Math.atan2(cur.y - prev.y, cur.x - prev.x));
            if (turn * sgn >= 0) continue;               // angle sortant : pas d'entaille
            var mag = Math.abs(turn);
            if (mag < 0.02) continue;                    // quasi droit
            var r = mag > 0.35 ? 0 : (l1 + l2) / 2 / mag;
            pts.push({ x: cur.x, y: cur.y, r: r, turn: mag });
        }
    }
    return pts;
}
function normAngle(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }

/**
 * Coefficient de concentration de contrainte.
 * Pas d'entaille → 1. Arête vive → 2,5. Congé généreux → ~1.
 * C'est exactement la leçon du cours : un raccordement arrondi tient bien mieux.
 */
function notchFactor(radius, thickness) {
    if (radius === null || radius === undefined || !isFinite(radius)) return 1;
    var rho = thickness > 0 ? radius / thickness : 0;
    var kt = 1 + 1.5 * Math.exp(-6 * rho);
    return Math.max(1, Math.min(2.5, kt));
}

/**
 * Balaie le bras libre (x > 0) section par section :
 *   M(x) = W·g·(x_bout − x)      σ(x) = Kt · M·c / I
 * Le poids maximal est celui qui amène la section la plus sollicitée
 * à la limite élastique du matériau.
 */
function computeStrength(worldLoops, depth, material, tableThickness) {
    var b = loopsBounds(worldLoops);
    var xTip = b.maxX;
    if (xTip <= 0.5) {
        return { ok: false, error: 'Aucun bras libre au-delà du bord de la table.' };
    }

    var fillets = filletRadii(worldLoops);
    var N = 160, stations = [];
    var sigmaAllow = material.yield * material.k;   // MPa = N/mm²
    var b_mm = depth;                                // largeur de la section = extrusion

    // centroïde de matière par section, pour estimer la pente du bras
    for (var i = 0; i <= N; i++) {
        var x = (xTip - 0.001) * i / N;
        var spans = solidSpans(worldLoops, 'x', Math.max(x, 0.001), 0.15);
        if (!spans.length) continue;

        var area = 0, sy = 0;
        for (var s = 0; s < spans.length; s++) {
            var h = spans[s][1] - spans[s][0];
            area += h; sy += h * (spans[s][0] + spans[s][1]) / 2;
        }
        var yc = sy / area;

        // inertie composée (Huygens) autour de l'axe neutre horizontal
        var I = 0, yMin = Infinity, yMax = -Infinity;
        for (var s2 = 0; s2 < spans.length; s2++) {
            var hh = spans[s2][1] - spans[s2][0];
            var mid = (spans[s2][0] + spans[s2][1]) / 2;
            I += (hh * hh * hh) / 12 + hh * (mid - yc) * (mid - yc);
            if (spans[s2][0] < yMin) yMin = spans[s2][0];
            if (spans[s2][1] > yMax) yMax = spans[s2][1];
        }
        I *= b_mm;                                   // mm⁴
        var cMax = Math.max(yMax - yc, yc - yMin);   // mm

        stations.push({ x: x, spans: spans, area: area * b_mm, yc: yc, I: I, c: cMax, hTotal: area });
    }
    if (stations.length < 5) return { ok: false, error: 'Bras libre trop court pour être calculé.' };

    // Ligne moyenne du bras : on la SUIT depuis le bout (là où pend le sac) en
    // enchaînant les intervalles qui se recouvrent. Prendre le centroïde de toute
    // la section ferait sauter la ligne moyenne dès qu'un second morceau de
    // matière apparaît, et la pente estimée deviendrait absurde.
    var trackY = null;
    for (var t = stations.length - 1; t >= 0; t--) {
        var sp = stations[t].spans, pick = null;
        for (var q = 0; q < sp.length; q++) {
            var mid = (sp[q][0] + sp[q][1]) / 2;
            if (trackY === null || (sp[q][0] - 0.5 <= trackY && trackY <= sp[q][1] + 0.5)) { pick = mid; break; }
            if (pick === null || Math.abs(mid - trackY) < Math.abs(pick - trackY)) pick = mid;
        }
        stations[t].armY = pick !== null ? pick : stations[t].yc;
        trackY = stations[t].armY;
    }

    // Pente locale : quand le bras plonge, une coupe verticale surestime
    // l'épaisseur réelle (h_vertical = h_réel / cos α), d'où la correction.
    // Bornée à 45° : au-delà, le modèle de poutre n'a de toute façon plus de sens.
    for (var k = 0; k < stations.length; k++) {
        var a = stations[Math.max(0, k - 4)], z = stations[Math.min(stations.length - 1, k + 4)];
        var dx = z.x - a.x;
        var slope = dx > 1e-6 ? (z.armY - a.armY) / dx : 0;
        slope = Math.max(-1, Math.min(1, slope));
        var cosA = 1 / Math.sqrt(1 + slope * slope);
        stations[k].slope = slope;
        stations[k].I *= cosA * cosA * cosA;   // I ∝ h³
        stations[k].c *= cosA;
    }

    // Entaille la plus sévère au droit de chaque section. Une buse d'imprimante
    // ne sait pas faire un angle parfaitement vif : même un coin « à 90° » sort
    // avec un rayon de l'ordre du rayon de buse, d'où le plancher.
    var NOZZLE_R = 0.4;
    for (var k2 = 0; k2 < stations.length; k2++) {
        var st = stations[k2], rMin = Infinity;
        for (var f = 0; f < fillets.length; f++) {
            if (Math.abs(fillets[f].x - st.x) < 1.0 && fillets[f].r < rMin) rMin = fillets[f].r;
        }
        st.filletRadius = rMin;
        st.kt = notchFactor(isFinite(rMin) ? Math.max(rMin, NOZZLE_R) : Infinity, st.hTotal);
    }

    // poids admissible section par section
    var best = null;
    for (var k3 = 0; k3 < stations.length; k3++) {
        var s3 = stations[k3];
        var lever = xTip - s3.x;                       // mm
        if (lever < 1 || s3.I <= 0 || s3.c <= 0) { s3.wAllow = Infinity; continue; }
        var M = sigmaAllow * s3.I / (s3.c * s3.kt);    // N·mm admissibles
        var F = M / lever;                              // N
        s3.wAllow = F / GRAVITY;                        // kg
        if (!best || s3.wAllow < best.wAllow) best = s3;
    }
    if (!best) return { ok: false, error: 'Calcul de flexion impossible.' };

    var maxWeight = Math.max(0, best.wAllow);

    // taux d'utilisation à la charge maximale (pour la coloration de la coupe)
    for (var k4 = 0; k4 < stations.length; k4++) {
        var s4 = stations[k4];
        s4.util = isFinite(s4.wAllow) && s4.wAllow > 0 ? Math.min(1, maxWeight / s4.wAllow) : 0;
    }

    return {
        ok: true,
        maxWeight: maxWeight,
        leverArm: xTip,
        hangPoint: hangPointOf(worldLoops, xTip),
        critical: best,
        stations: stations,
        sigmaAllow: sigmaAllow
    };
}

/** Point d'accroche : le bout du bras (là où pend réellement la sangle). */
function hangPointOf(worldLoops, xTip) {
    var spans = solidSpans(worldLoops, 'x', xTip - 0.3, 0.05);
    if (!spans.length) return { x: xTip, y: 0 };
    var lowest = spans[0];
    return { x: xTip, y: (lowest[0] + lowest[1]) / 2 };
}

// ===========================================================================
// 7. API
// ===========================================================================

function analyze(arrayBuffer, opts) {
    opts = opts || {};
    var T = opts.tableThickness != null ? opts.tableThickness : 20;
    var material = Object.assign({}, DEFAULT_MATERIAL, opts.material || {});
    var warnings = [];

    var parsed;
    try { parsed = parseSTL(arrayBuffer); }
    catch (e) { return fail('Lecture STL impossible : ' + e.message); }
    if (!parsed.triangles.length) return fail('Fichier STL vide.');

    var bnd = parsed.bounds;
    var dims = {
        x: bnd.max.x - bnd.min.x,
        y: bnd.max.y - bnd.min.y,
        z: bnd.max.z - bnd.min.z
    };
    var sorted = [dims.x, dims.y, dims.z].sort(function (a, b) { return a - b; });

    // On teste LES TROIS axes d'extrusion et on collecte TOUTES les fentes
    // plausibles : ce sont autant de « lectures » possibles de la pièce, classées
    // de la plus crédible à la moins crédible. Le prof peut passer de l'une à
    // l'autre depuis le correcteur quand l'automatique se trompe.
    var ranked = rankExtrusionAxes(parsed.triangles, bnd);
    var lastErr = null, tries = [];

    for (var r = 0; r < ranked.length; r++) {
        try {
            var sec = extractSection(parsed.triangles, bnd, ranked[r].axis);
            var sb = loopsBounds(sec.loops);
            var det = detectSlot(sec.loops, sb);
            var bonus = sec.constantSection ? 40 : 0;   // un profil extrudé est bien plus probable
            for (var ci = 0; ci < det.all.length; ci++) {
                // On garde même les lectures que l'automatique juge douteuses :
                // c'est justement parmi elles que se trouve la bonne quand la
                // pièce est modélisée de travers. Le tri les met en dernier.
                if (det.all[ci].score < -100) continue;
                tries.push({
                    axis: ranked[r].axis, section: sec, slot: det.all[ci], candidates: det.all,
                    secBounds: sb, rank: r, total: det.all[ci].score + bonus
                });
            }
        } catch (e) { lastErr = e; }
    }
    if (!tries.length) return fail(lastErr ? lastErr.message : 'Aucune fente exploitable.');

    tries.sort(function (a, b) { return b.total - a.total; });
    tries = dedupeVariants(tries).slice(0, 6);

    var variant = Math.max(0, Math.min(tries.length - 1, opts.variant | 0));
    var chosen = tries[variant];
    refineSlot(chosen.section.loops, chosen.slot, chosen.secBounds);

    if (variant === 0 && tries.length > 1 && (tries[0].total - tries[1].total) < 25) {
        warnings.push("Plusieurs lectures de la pièce sont possibles — vérifier la coupe.");
    }
    if (chosen.total < 0) warnings.push("Lecture peu fiable : cette fente ne ressemble pas à un support de sac.");
    if (!chosen.section.constantSection) warnings.push("La section n'est pas constante (pièce non extrudée) — coupe prise au milieu.");

    var canon = canonicalize(chosen.section.loops, chosen.slot, chosen.secBounds);
    var S = canon.slotHeight, G = canon.grip;

    // Sens d'insertion haut/bas. Par défaut on le déduit du crochet (il doit
    // s'ouvrir vers le haut, sinon le sac tombe) ; opts.flip permet au prof de
    // forcer le miroir quand la pièce ne se lit pas toute seule.
    var flipped = (opts.flip === true || opts.flip === false) ? opts.flip : shouldFlip(canon.loops);
    if (flipped) {
        canon.loops = canon.loops.map(function (l) {
            return l.map(function (p) { return { x: p.x, y: S - p.y }; });
        });
    }

    var fitTol = opts.fitTolerance != null ? opts.fitTolerance : 0.2;
    var placed = placeOnTable(canon, T, fitTol);
    var strength = computeStrength(placed.loops, chosen.section.depth, material, T);

    if (!placed.tilt.fits) warnings.push('La fente (' + S.toFixed(1) + ' mm) est trop petite pour la table (' + T + ' mm) : le support ne s\'insère pas.');
    else if (placed.tilt.slips) warnings.push('Trop de jeu dans la fente : le support bascule de ' + (placed.theta * 180 / Math.PI).toFixed(0) + '° et décroche.');
    if (S > 45 || S < 5) warnings.push('Hauteur de fente inhabituelle (' + S.toFixed(1) + ' mm) — interprétation à vérifier.');

    // Poids retenu : 0 si le support ne tient pas mécaniquement sur la table.
    var maxWeight = 0;
    if (strength.ok) maxWeight = strength.maxWeight;
    if (!placed.tilt.fits || placed.tilt.slips) maxWeight = 0;
    if (maxWeight > 40) {
        warnings.push('Résistance hors échelle (' + maxWeight.toFixed(0) + ' kg) — la coupe est probablement mal interprétée.');
        maxWeight = 40;
    }

    var confidence = scoreConfidence(chosen, canon, strength, maxWeight);

    return {
        ok: true,
        error: null,
        dimensions: { x: dims.x, y: dims.y, z: dims.z, sorted: sorted },
        extrusionAxis: chosen.axis,
        sectionAxes: chosen.section.axes,
        depth: chosen.section.depth,
        slot: {
            height: S, grip: G, armExtent: canon.armExtent,
            flipped: flipped
        },
        // lectures alternatives de la pièce, pour reprendre la main sur l'automatique
        variant: variant,
        variantCount: tries.length,
        variantLabel: variantLabel(chosen),
        variantLabels: tries.map(variantLabel),
        insertion: {
            tableThickness: T,
            fits: placed.tilt.fits,
            slips: !!placed.tilt.slips,
            tiltDeg: placed.theta * 180 / Math.PI,
            clearance: S - T,
            contacts: placed.contacts,
            interference: placed.interference
        },
        strength: strength,
        maxWeight: maxWeight,
        leverArm: strength.ok ? strength.leverArm : 0,
        geometry: {
            canonical: canon.loops,
            world: placed.loops,
            bounds: loopsBounds(placed.loops)
        },
        material: material,
        confidence: confidence,
        warnings: warnings
    };

    function fail(msg) {
        return { ok: false, error: msg, warnings: warnings, maxWeight: 0 };
    }
}

/**
 * Deux lectures qui décrivent la même fente (même axe, même bouche, même fond)
 * n'ont pas à être proposées deux fois au professeur.
 */
function dedupeVariants(list) {
    var seen = {}, out = [];
    for (var i = 0; i < list.length; i++) {
        var t = list[i];
        var key = t.axis + '|' + t.slot.scanAxis + '|' + Math.round(t.slot.mouth) + '|' +
                  Math.round(t.slot.wall) + '|' + Math.round(t.slot.height);
        if (seen[key]) continue;
        seen[key] = 1; out.push(t);
    }
    return out;
}

/** Étiquette courte d'une lecture, pour que le prof sache ce qu'il choisit. */
function variantLabel(t) {
    return 'fente ' + t.slot.height.toFixed(1) + ' mm, prise ' + t.slot.grip.toFixed(0) +
           ' mm (coupe ⟂ ' + t.axis.toUpperCase() + ')';
}

/** Le crochet doit s'ouvrir vers le haut : sinon on retourne la coupe. */
function shouldFlip(loops) {
    var b = loopsBounds(loops);
    if (b.maxX <= 1) return false;
    function centroidAt(x) {
        var sp = solidSpans(loops, 'x', x, 0.15);
        if (!sp.length) return null;
        var a = 0, sy = 0;
        for (var i = 0; i < sp.length; i++) {
            var h = sp[i][1] - sp[i][0];
            a += h; sy += h * (sp[i][0] + sp[i][1]) / 2;
        }
        return sy / a;
    }
    var mid = centroidAt(b.maxX * 0.6), tip = centroidAt(b.maxX * 0.97);
    if (mid == null || tip == null) return false;
    // le bras remonte vers le bout → le crochet retient : orientation correcte
    return (tip - mid) < -0.5 ? true : false;
}

function scoreConfidence(chosen, canon, strength, maxWeight) {
    var c = 1;
    if (!chosen.section.constantSection) c -= 0.35;   // pièce non extrudée : une seule coupe ne suffit pas
    if (canon.armExtent < 8) c -= 0.3;                // sans bras, ce n'est pas un support de sac
    if (canon.grip < 8) c -= 0.25;
    if (canon.slotHeight < 6 || canon.slotHeight > 45) c -= 0.3;
    if (chosen.total < 0) c -= 0.5;
    if (!strength.ok) c -= 0.4;
    if (maxWeight > 30) c -= 0.3;                      // résistance invraisemblable = lecture douteuse
    if (chosen.candidates.length > 1) {
        var gap = chosen.candidates[0].score - chosen.candidates[1].score;
        if (gap < 25) c -= 0.2;                        // deux fentes possibles dans la même coupe
    }
    return Math.max(0, Math.min(1, c));
}

// ===========================================================================
// 8. RENDU DE LA COUPE (SVG) — identique dans le correcteur et le simulateur
// ===========================================================================

function stressColor(u) {
    u = Math.max(0, Math.min(1, u));
    if (u < 0.5) { var t = u / 0.5; return 'rgb(' + Math.round(60 + t * 180) + ',' + Math.round(200 - t * 20) + ',' + Math.round(120 - t * 100) + ')'; }
    var t2 = (u - 0.5) / 0.5;
    return 'rgb(' + Math.round(240 + t2 * 15) + ',' + Math.round(180 - t2 * 130) + ',' + Math.round(20 + t2 * 30) + ')';
}

function renderSVG(res, opt) {
    opt = opt || {};
    if (!res || !res.ok) {
        return '<svg viewBox="0 0 200 100"><text x="100" y="55" fill="#f87171" font-size="11" text-anchor="middle">' +
            esc(res && res.error ? res.error : 'analyse impossible') + '</text></svg>';
    }
    var T = res.insertion.tableThickness;
    var b = res.geometry.bounds;
    var tableLen = Math.max(28, (b.maxX - b.minX) * 0.55);
    var minX = Math.min(b.minX, -tableLen) - 4;
    var maxX = b.maxX + 6;
    var minY = Math.min(b.minY, 0) - 6;
    var maxY = Math.max(b.maxY, T) + 6;
    var W = maxX - minX, H = maxY - minY;
    var showStress = opt.stress !== false && res.strength && res.strength.ok;

    var s = [];
    s.push('<svg viewBox="' + f(minX) + ' ' + f(-maxY) + ' ' + f(W) + ' ' + f(H) + '" preserveAspectRatio="xMidYMid meet"' +
        (opt.width ? ' width="' + opt.width + '"' : '') + (opt.height ? ' height="' + opt.height + '"' : '') + '>');
    s.push('<defs><pattern id="wood' + uid + '" width="3" height="3" patternUnits="userSpaceOnUse">' +
        '<rect width="3" height="3" fill="#6b5844"/><path d="M0 1.5h3" stroke="#5a4a38" stroke-width="0.4"/></pattern></defs>');

    // table
    s.push('<rect x="' + f(minX) + '" y="' + f(-T) + '" width="' + f(-minX) + '" height="' + f(T) +
        '" fill="url(#wood' + uid + ')" stroke="#3d3226" stroke-width="0.35"/>');
    s.push('<line x1="0" y1="' + f(-T) + '" x2="0" y2="0" stroke="#f1c40f" stroke-width="0.6"/>');

    // support, coloré par taux de contrainte
    var d = res.geometry.world.map(function (loop) {
        return loop.map(function (p, i) { return (i ? 'L' : 'M') + f(p.x) + ' ' + f(-p.y); }).join(' ') + ' Z';
    }).join(' ');
    s.push('<path d="' + d + '" fill="#4a90d9" fill-opacity="0.20" stroke="#4a90d9" stroke-width="0.5" fill-rule="evenodd"/>');

    if (showStress) {
        var st = res.strength.stations;
        for (var i = 0; i < st.length; i++) {
            var stn = st[i];
            for (var k = 0; k < stn.spans.length; k++) {
                var dx = (i + 1 < st.length ? st[i + 1].x - stn.x : 0.4);
                s.push('<rect x="' + f(stn.x) + '" y="' + f(-stn.spans[k][1]) + '" width="' + f(Math.max(dx, 0.3)) +
                    '" height="' + f(stn.spans[k][1] - stn.spans[k][0]) + '" fill="' + stressColor(stn.util) + '" fill-opacity="0.85"/>');
            }
        }
        s.push('<path d="' + d + '" fill="none" stroke="#1b2233" stroke-width="0.45" fill-rule="evenodd"/>');

        // section critique
        var cr = res.strength.critical;
        s.push('<line x1="' + f(cr.x) + '" y1="' + f(-(cr.yc + cr.c + 2.5)) + '" x2="' + f(cr.x) + '" y2="' + f(-(cr.yc - cr.c - 2.5)) +
            '" stroke="#ff3b30" stroke-width="0.5" stroke-dasharray="1.2 0.8"/>');
    }

    // fente trop petite : la table traverse la mâchoire — on montre le conflit
    var itf = res.insertion.interference;
    if (itf) {
        s.push('<rect x="' + f(itf.xMin) + '" y="' + f(-itf.yMax) + '" width="' + f(itf.xMax - itf.xMin) +
            '" height="' + f(itf.yMax - itf.yMin) + '" fill="#ff3b30" fill-opacity="0.45" stroke="#ff3b30" stroke-width="0.4"/>');
    }

    // points de contact
    if (res.insertion.fits) {
        for (var c2 = 0; c2 < res.insertion.contacts.length; c2++) {
            var ct = res.insertion.contacts[c2];
            s.push('<circle cx="' + f(ct.x) + '" cy="' + f(-ct.y) + '" r="1.1" fill="#2ecc71" stroke="#0f1525" stroke-width="0.3"/>');
        }
    }

    // sac accroché au bout du bras
    if (res.strength && res.strength.ok) {
        var hp = res.strength.hangPoint;
        s.push('<line x1="' + f(hp.x) + '" y1="' + f(-hp.y) + '" x2="' + f(hp.x) + '" y2="' + f(-(hp.y - 9)) +
            '" stroke="#e74c3c" stroke-width="0.7"/>');
        s.push('<path d="M' + f(hp.x - 1.6) + ' ' + f(-(hp.y - 7.2)) + 'L' + f(hp.x) + ' ' + f(-(hp.y - 10)) +
            'L' + f(hp.x + 1.6) + ' ' + f(-(hp.y - 7.2)) + 'Z" fill="#e74c3c"/>');
    }

    s.push('</svg>');
    uid++;
    return s.join('');
}

var uid = 0;
function f(v) { return Math.round(v * 100) / 100; }
function esc(t) { return String(t).replace(/[<>&"]/g, function (c) { return ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]; }); }

// ===========================================================================

var API = {
    analyze: analyze,
    renderSVG: renderSVG,
    parseSTL: parseSTL,
    computeTilt: computeTilt,
    solidSpans: solidSpans,
    DEFAULT_MATERIAL: DEFAULT_MATERIAL,
    GRAVITY: GRAVITY
};

if (typeof module !== 'undefined' && module.exports) module.exports = API;
global.SectionEngine = API;

})(typeof window !== 'undefined' ? window : globalThis);
