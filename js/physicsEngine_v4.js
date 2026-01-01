// Moteur de simulation physique V4 - Focus sur les JONCTIONS
// La fragilité est aux JONCTIONS (changements de direction) sur la face ARRIÈRE

class PhysicsEngineV4 {
    constructor() {
        this.material = {
            yieldStrength: 50, // MPa
        };
        
        this.gravity = 9.81;
        this.tableThickness = 2.1;
        this.tableEdgeX = 0;
    }

    simulateWithHangingPoint(geometry, meshPosition, meshRotation, hangingPoint, weight) {
        console.log('🔬 === MOTEUR V4 - DÉTECTION DES JONCTIONS ===');
        
        // 1. Extraire les vertices
        const vertices = this.extractWorldVertices(geometry, meshPosition, meshRotation);
        
        // 2. Détecter les JONCTIONS (zones où la géométrie change de direction)
        const junctions = this.detectJunctions(vertices);
        
        // 3. Calculer le centre Z de la structure (pour déterminer arrière/avant)
        const structureCenter = this.calculateStructureCenter(vertices);
        
        // 4. Calculer les contraintes
        const stressAnalysis = this.calculateStress(vertices, junctions, structureCenter, hangingPoint, weight);
        
        // 5. Résultat
        const failureAnalysis = this.analyzeFailure(stressAnalysis, weight);
        
        return {
            vertices,
            junctions,
            stressAnalysis,
            failureAnalysis,
            maxWeight: failureAnalysis.maxSafeWeight,
            safety: failureAnalysis.safety
        };
    }

    extractWorldVertices(geometry, meshPosition, meshRotation) {
        const positions = geometry.attributes.position;
        const vertices = [];
        
        for (let i = 0; i < positions.count; i++) {
            const v = new THREE.Vector3(
                positions.getX(i),
                positions.getY(i),
                positions.getZ(i)
            );
            
            v.multiplyScalar(0.1);
            v.applyEuler(meshRotation);
            v.add(meshPosition);
            
            vertices.push({ position: v.clone(), index: i });
        }
        
        return vertices;
    }

    /**
     * DÉTECTER LES JONCTIONS
     * Une jonction = zone où la direction de la structure change brusquement
     * 
     * Méthode : analyser la distribution des vertices autour de chaque point
     * Si la distribution est asymétrique (ex: beaucoup à gauche, peu en haut)
     * = c'est une jonction
     */
    detectJunctions(vertices) {
        console.log('🔍 Détection des jonctions...');
        
        const junctions = [];
        const gridSize = 2; // cm
        
        // Créer une grille de cellules
        const grid = new Map();
        
        vertices.forEach(v => {
            const cellX = Math.floor(v.position.x / gridSize);
            const cellY = Math.floor(v.position.y / gridSize);
            const cellZ = Math.floor(v.position.z / gridSize);
            const key = `${cellX},${cellY},${cellZ}`;
            
            if (!grid.has(key)) {
                grid.set(key, {
                    vertices: [],
                    center: new THREE.Vector3(
                        (cellX + 0.5) * gridSize,
                        (cellY + 0.5) * gridSize,
                        (cellZ + 0.5) * gridSize
                    )
                });
            }
            grid.get(key).vertices.push(v);
        });
        
        // Pour chaque cellule, analyser si c'est une jonction
        grid.forEach((cell, key) => {
            if (cell.vertices.length < 3) return;
            
            const center = cell.center;
            
            // Ignorer les cellules dans la table (ancrage)
            if (center.y > this.tableThickness + 1 && center.x < -2) return;
            
            // Compter les vertices dans chaque direction
            const directions = {
                up: 0,      // +Y
                down: 0,    // -Y
                left: 0,    // -X (vers table)
                right: 0,   // +X (vers extérieur)
                front: 0,   // +Z
                back: 0     // -Z
            };
            
            const checkRadius = gridSize * 2;
            
            vertices.forEach(v => {
                const dx = v.position.x - center.x;
                const dy = v.position.y - center.y;
                const dz = v.position.z - center.z;
                const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
                
                if (dist < checkRadius && dist > gridSize * 0.5) {
                    if (dy > gridSize) directions.up++;
                    if (dy < -gridSize) directions.down++;
                    if (dx < -gridSize) directions.left++;
                    if (dx > gridSize) directions.right++;
                    if (dz > gridSize) directions.front++;
                    if (dz < -gridSize) directions.back++;
                }
            });
            
            // Une JONCTION = distribution très asymétrique
            // Ex: beaucoup à gauche et en bas, mais rien en haut = angle en L
            const total = directions.up + directions.down + directions.left + directions.right;
            
            if (total < 10) return; // Pas assez de données
            
            // Calculer l'asymétrie
            const verticalRatio = Math.abs(directions.up - directions.down) / (directions.up + directions.down + 1);
            const horizontalRatio = Math.abs(directions.left - directions.right) / (directions.left + directions.right + 1);
            
            // Si forte asymétrie dans les deux directions = jonction
            const isJunction = (verticalRatio > 0.6 && horizontalRatio > 0.3) ||
                              (horizontalRatio > 0.6 && verticalRatio > 0.3) ||
                              (directions.up < 5 && directions.down > 20) || // Rien au-dessus = base d'un pilier
                              (directions.down < 5 && directions.up > 20) || // Rien en-dessous = haut d'un pilier
                              (directions.left < 5 && directions.right > 20) ||
                              (directions.right < 5 && directions.left > 20);
            
            if (isJunction) {
                // Score de jonction basé sur l'asymétrie
                const score = Math.max(verticalRatio, horizontalRatio) * 2 + 0.5;
                
                junctions.push({
                    center: center.clone(),
                    score: score,
                    directions: { ...directions }
                });
            }
        });
        
        console.log('  Jonctions détectées:', junctions.length);
        
        // Filtrer pour garder les plus significatives
        junctions.sort((a, b) => b.score - a.score);
        const topJunctions = junctions.slice(0, 20);
        
        topJunctions.forEach((j, i) => {
            console.log(`  #${i+1}: (${j.center.x.toFixed(1)}, ${j.center.y.toFixed(1)}, ${j.center.z.toFixed(1)}) score=${j.score.toFixed(2)}`);
        });
        
        return topJunctions;
    }

    /**
     * Calculer le centre Z de la structure (pour déterminer arrière/avant)
     */
    calculateStructureCenter(vertices) {
        let sumX = 0, sumY = 0, sumZ = 0;
        let count = 0;
        
        // Ne considérer que les vertices hors de la table
        vertices.forEach(v => {
            if (v.position.y < this.tableThickness + 2) {
                sumX += v.position.x;
                sumY += v.position.y;
                sumZ += v.position.z;
                count++;
            }
        });
        
        return count > 0 
            ? new THREE.Vector3(sumX/count, sumY/count, sumZ/count)
            : new THREE.Vector3(0, 0, 0);
    }

    /**
     * Calculer les contraintes pour chaque vertex
     */
    calculateStress(vertices, junctions, structureCenter, hangingPoint, weight) {
        console.log('📊 Calcul des contraintes...');
        
        const force = weight * this.gravity;
        const stressMap = [];
        
        // Calculer le bras de levier
        const leverArm = Math.abs(hangingPoint.x - this.tableEdgeX);
        console.log('  Bras de levier:', leverArm.toFixed(1), 'cm');
        
        // Calculer une contrainte de base
        const baseStress = (force * leverArm / 100) / (0.01 * 0.01 * 0.01 / 12) / 1e6 * 0.001;
        console.log('  Contrainte base:', baseStress.toFixed(2), 'MPa');
        
        vertices.forEach(v => {
            const pos = v.position;
            
            // Zone d'ancrage (sur la table) = pas de contrainte
            if (pos.y > this.tableThickness + 0.5 && pos.x < -1) {
                stressMap.push({ vertex: v, stress: 0, inAnchorZone: true });
                return;
            }
            
            // Calculer le score de contrainte
            let stress = 0;
            
            // === FACTEUR 1 : Proximité aux JONCTIONS ===
            // C'est le facteur le plus important !
            let junctionFactor = 0;
            junctions.forEach(j => {
                const dist = pos.distanceTo(j.center);
                if (dist < 8) { // Rayon d'influence
                    // Plus on est proche, plus c'est critique
                    const influence = Math.pow(1 - dist/8, 2) * j.score;
                    junctionFactor = Math.max(junctionFactor, influence);
                }
            });
            
            // === FACTEUR 2 : Position ARRIÈRE (côté table) vs AVANT ===
            // Le côté arrière est en TENSION
            // On utilise la position Z par rapport au centre de la structure
            let tensionFactor = 1.0;
            const relativeZ = pos.z - structureCenter.z;
            
            // Pour la plupart des supports, Z négatif = arrière = tension
            // Mais cela dépend de l'orientation, donc on utilise une approche plus robuste
            // On regarde si le vertex est du côté OPPOSÉ au point d'accrochage en Z
            const hangZ = hangingPoint.z;
            const towardHang = (pos.z - structureCenter.z) * (hangZ - structureCenter.z) > 0;
            
            if (!towardHang) {
                // Côté opposé au point d'accrochage = TENSION
                tensionFactor = 2.0;
            } else {
                // Côté du point d'accrochage = compression
                tensionFactor = 0.5;
            }
            
            // === FACTEUR 3 : Proximité du bord de table (pivot) ===
            let pivotFactor = 1.0;
            if (pos.y < this.tableThickness + 3 && pos.y > -3) {
                // Zone autour du bord de table
                const distToPivotY = Math.abs(pos.y - this.tableThickness);
                pivotFactor = 1.5 - distToPivotY / 6;
                pivotFactor = Math.max(1.0, pivotFactor);
            }
            
            // === FACTEUR 4 : Bras de levier (distance horizontale) ===
            let leverFactor = 1.0;
            const distToHang = Math.abs(pos.x - hangingPoint.x);
            if (pos.x < this.tableEdgeX) {
                // Derrière le pivot = moment constant (max)
                leverFactor = 1.5;
            } else {
                // Entre pivot et point d'accrochage = moment décroissant
                leverFactor = 0.3 + (distToHang / leverArm) * 1.2;
            }
            
            // === CALCUL FINAL ===
            stress = baseStress * (1 + junctionFactor * 5) * tensionFactor * pivotFactor * leverFactor;
            
            stressMap.push({
                vertex: v,
                stress: Math.max(0, stress),
                inAnchorZone: false,
                junctionFactor,
                tensionFactor,
                pivotFactor,
                leverFactor
            });
        });
        
        // Trouver le maximum
        let maxStress = 0;
        let maxVertex = null;
        stressMap.forEach(sm => {
            if (sm.stress > maxStress) {
                maxStress = sm.stress;
                maxVertex = sm.vertex;
            }
        });
        
        console.log('  Contrainte max:', maxStress.toFixed(2), 'MPa');
        
        return {
            stressMap,
            maxStress,
            maxStressVertex: maxVertex,
            criticalPoint: maxVertex ? maxVertex.position : null
        };
    }

    analyzeFailure(stressAnalysis, weight) {
        const maxStress = stressAnalysis.maxStress;
        const yieldStrength = this.material.yieldStrength;
        
        const safetyFactor = maxStress > 0 ? yieldStrength / maxStress : 10;
        
        let maxSafeWeight = weight * safetyFactor * 0.5;
        maxSafeWeight = Math.min(Math.max(maxSafeWeight, 1), 15);
        
        let safety, message;
        if (safetyFactor >= 2.0) {
            safety = 'safe';
            message = 'Solide';
        } else if (safetyFactor >= 1.0) {
            safety = 'warning';
            message = 'Fragile';
        } else {
            safety = 'danger';
            message = 'Va casser';
        }
        
        console.log('📋 Résultat:', safety, '- Poids max:', maxSafeWeight.toFixed(1), 'kg');
        
        return {
            safetyFactor,
            maxSafeWeight,
            safety,
            message,
            maxStress,
            failurePoint: stressAnalysis.criticalPoint
        };
    }
}

window.PhysicsEngineV4 = PhysicsEngineV4;
