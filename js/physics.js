// Simulateur de physique pour l'analyse structurelle
class PhysicsSimulator {
    constructor() {
        // Propriétés du matériau PLA (plastique d'impression 3D)
        this.material = {
            name: 'PLA',
            yieldStrength: 50, // MPa (résistance à la traction)
            density: 1.25, // g/cm³
            elasticModulus: 3500, // MPa (module d'Young)
            poissonRatio: 0.36
        };

        // Facteurs de sécurité
        this.safetyFactors = {
            excellent: 3.0,
            good: 2.0,
            acceptable: 1.5,
            critical: 1.0
        };

        // Gravité
        this.gravity = 9.81; // m/s²
    }

    analyzeGeometry(geometry) {
        const positions = geometry.attributes.position;
        const vertices = [];

        // Extraire tous les vertices
        for (let i = 0; i < positions.count; i++) {
            vertices.push(new THREE.Vector3(
                positions.getX(i),
                positions.getY(i),
                positions.getZ(i)
            ));
        }

        // Calculer les dimensions
        const bbox = new THREE.Box3().setFromPoints(vertices);
        const size = bbox.getSize(new THREE.Vector3());

        // Calculer le volume approximatif
        const volume = this.calculateVolume(geometry);

        // Calculer la surface
        const surfaceArea = this.calculateSurfaceArea(geometry);

        // Nombre de triangles
        const triangleCount = positions.count / 3;

        return {
            dimensions: {
                x: size.x,
                y: size.y,
                z: size.z
            },
            volume: volume / 1000, // Convertir en cm³
            surfaceArea: surfaceArea / 100, // Convertir en cm²
            triangleCount: triangleCount,
            bbox: bbox
        };
    }

    calculateVolume(geometry) {
        const positions = geometry.attributes.position;
        let volume = 0;

        // Méthode du tétraèdre signé
        for (let i = 0; i < positions.count; i += 3) {
            const v1 = new THREE.Vector3(
                positions.getX(i),
                positions.getY(i),
                positions.getZ(i)
            );
            const v2 = new THREE.Vector3(
                positions.getX(i + 1),
                positions.getY(i + 1),
                positions.getZ(i + 1)
            );
            const v3 = new THREE.Vector3(
                positions.getX(i + 2),
                positions.getY(i + 2),
                positions.getZ(i + 2)
            );

            // Volume du tétraèdre formé par l'origine et le triangle
            volume += v1.dot(v2.cross(v3)) / 6;
        }

        return Math.abs(volume);
    }

    calculateSurfaceArea(geometry) {
        const positions = geometry.attributes.position;
        let area = 0;

        // Calculer l'aire de chaque triangle
        for (let i = 0; i < positions.count; i += 3) {
            const v1 = new THREE.Vector3(
                positions.getX(i),
                positions.getY(i),
                positions.getZ(i)
            );
            const v2 = new THREE.Vector3(
                positions.getX(i + 1),
                positions.getY(i + 1),
                positions.getZ(i + 1)
            );
            const v3 = new THREE.Vector3(
                positions.getX(i + 2),
                positions.getY(i + 2),
                positions.getZ(i + 2)
            );

            // Aire du triangle = 1/2 * ||(v2-v1) × (v3-v1)||
            const edge1 = v2.clone().sub(v1);
            const edge2 = v3.clone().sub(v1);
            const cross = edge1.cross(edge2);
            area += cross.length() / 2;
        }

        return area;
    }

    simulate(geometry, position, weight) {
        const analysis = this.analyzeGeometry(geometry);
        
        // Calculer la force appliquée (en Newtons)
        const force = weight * this.gravity;

        // Analyser les points critiques
        const criticalPoints = this.findCriticalPoints(geometry, position, force);

        // Calculer les contraintes
        const stressAnalysis = this.calculateStress(geometry, position, force, criticalPoints);

        // Déterminer la sécurité
        const safety = this.evaluateSafety(stressAnalysis);

        // Générer les recommandations
        const recommendation = this.generateRecommendation(safety, stressAnalysis, weight);

        return {
            maxStress: stressAnalysis.maxStress,
            criticalPoint: stressAnalysis.criticalPointName,
            breakPoints: stressAnalysis.breakPoints,
            safetyFactor: stressAnalysis.safetyFactor,
            safety: safety.level,
            recommendation: recommendation,
            analysis: analysis
        };
    }

    findCriticalPoints(geometry, position, force) {
        const positions = geometry.attributes.position;
        const vertices = [];

        // Extraire et transformer les vertices avec la position du mesh
        for (let i = 0; i < positions.count; i++) {
            const v = new THREE.Vector3(
                positions.getX(i) + position.x,
                positions.getY(i) + position.y,
                positions.getZ(i) + position.z
            );
            vertices.push(v);
        }

        // Identifier les zones critiques
        const criticalPoints = {
            lowestPoint: null,
            lowestY: Infinity,
            highestPoint: null,
            highestY: -Infinity,
            thinnestSection: null,
            thinnestWidth: Infinity,
            hookPoint: null, // Point où le sac va accrocher
            connectionToTable: null // Point de connexion avec la table
        };

        // Trouver les points extrêmes
        vertices.forEach((v, index) => {
            if (v.y < criticalPoints.lowestY) {
                criticalPoints.lowestY = v.y;
                criticalPoints.lowestPoint = v.clone();
            }
            if (v.y > criticalPoints.highestY) {
                criticalPoints.highestY = v.y;
                criticalPoints.highestPoint = v.clone();
            }
        });

        // Estimer le point d'accrochage (partie la plus basse et externe)
        let maxDistanceFromCenter = 0;
        vertices.forEach(v => {
            if (v.y < criticalPoints.lowestY + 10) { // Dans la zone basse
                const distFromCenter = Math.sqrt(v.x * v.x + v.z * v.z);
                if (distFromCenter > maxDistanceFromCenter) {
                    maxDistanceFromCenter = distFromCenter;
                    criticalPoints.hookPoint = v.clone();
                }
            }
        });

        // Point de connexion avec la table (partie dans/sur la table, ~2.1cm)
        const tableHeight = 2.1;
        vertices.forEach(v => {
            if (Math.abs(v.y - tableHeight) < 2) {
                if (!criticalPoints.connectionToTable) {
                    criticalPoints.connectionToTable = v.clone();
                }
            }
        });

        // Analyser les sections pour trouver la plus fine
        this.analyzeThickness(vertices, criticalPoints);

        return criticalPoints;
    }

    analyzeThickness(vertices, criticalPoints) {
        // Diviser en sections verticales et mesurer l'épaisseur
        const sections = 10;
        const yRange = criticalPoints.highestY - criticalPoints.lowestY;
        
        for (let i = 0; i < sections; i++) {
            const yLevel = criticalPoints.lowestY + (yRange * i / sections);
            const pointsAtLevel = vertices.filter(v => 
                Math.abs(v.y - yLevel) < yRange / sections
            );

            if (pointsAtLevel.length > 0) {
                // Calculer l'étendue en X et Z
                const xValues = pointsAtLevel.map(v => v.x);
                const zValues = pointsAtLevel.map(v => v.z);
                const xRange = Math.max(...xValues) - Math.min(...xValues);
                const zRange = Math.max(...zValues) - Math.min(...zValues);
                const minDimension = Math.min(xRange, zRange);

                if (minDimension < criticalPoints.thinnestWidth && minDimension > 0.1) {
                    criticalPoints.thinnestWidth = minDimension;
                    criticalPoints.thinnestSection = new THREE.Vector3(
                        (Math.max(...xValues) + Math.min(...xValues)) / 2,
                        yLevel,
                        (Math.max(...zValues) + Math.min(...zValues)) / 2
                    );
                }
            }
        }
    }

    calculateStress(geometry, position, force, criticalPoints) {
        const breakPoints = [];
        let maxStress = 0;
        let criticalPointName = '';

        // 1. Contrainte au point d'accrochage (moment de flexion)
        if (criticalPoints.hookPoint && criticalPoints.connectionToTable) {
            const leverArm = Math.abs(
                criticalPoints.hookPoint.y - criticalPoints.connectionToTable.y
            );
            const moment = force * (leverArm / 1000); // Convertir en mètres

            // Section approximative (simplification)
            const crossSectionArea = Math.PI * Math.pow(criticalPoints.thinnestWidth / 2000, 2); // en m²
            const sectionModulus = crossSectionArea * (criticalPoints.thinnestWidth / 2000); // Approximation

            const bendingStress = sectionModulus > 0 ? (moment / sectionModulus) / 1e6 : 0; // En MPa

            if (bendingStress > maxStress) {
                maxStress = bendingStress;
                criticalPointName = 'Point d\'accrochage';
            }

            if (bendingStress > this.material.yieldStrength * 0.7) {
                breakPoints.push({
                    position: criticalPoints.hookPoint,
                    stress: bendingStress,
                    type: 'bending'
                });
            }
        }

        // 2. Contrainte à la section la plus fine (contrainte de cisaillement)
        if (criticalPoints.thinnestSection) {
            const crossSectionArea = Math.PI * Math.pow(criticalPoints.thinnestWidth / 2000, 2); // en m²
            const shearStress = crossSectionArea > 0 ? (force / crossSectionArea) / 1e6 : 0; // En MPa

            if (shearStress > maxStress) {
                maxStress = shearStress;
                criticalPointName = 'Section la plus fine';
            }

            if (shearStress > this.material.yieldStrength * 0.6) {
                breakPoints.push({
                    position: criticalPoints.thinnestSection,
                    stress: shearStress,
                    type: 'shear'
                });
            }
        }

        // 3. Contrainte au point de connexion avec la table (traction/arrachement)
        if (criticalPoints.connectionToTable) {
            // Estimation de la surface de contact
            const contactArea = Math.pow(20 / 1000, 2); // 20mm × 20mm en m²
            const pulloutStress = (force / contactArea) / 1e6; // En MPa

            if (pulloutStress > maxStress * 0.8) { // Important mais pas toujours le plus critique
                if (!criticalPointName.includes('connexion')) {
                    criticalPointName += ' / Point de connexion';
                }
            }

            if (pulloutStress > this.material.yieldStrength * 0.5) {
                breakPoints.push({
                    position: criticalPoints.connectionToTable,
                    stress: pulloutStress,
                    type: 'pullout'
                });
            }
        }

        // Calculer le facteur de sécurité
        const safetyFactor = maxStress > 0 ? this.material.yieldStrength / maxStress : Infinity;

        return {
            maxStress: maxStress,
            criticalPointName: criticalPointName || 'Structure générale',
            breakPoints: breakPoints,
            safetyFactor: safetyFactor
        };
    }

    evaluateSafety(stressAnalysis) {
        const sf = stressAnalysis.safetyFactor;

        if (sf >= this.safetyFactors.excellent) {
            return {
                level: 'safe',
                message: 'Excellent ! Le support est très solide.',
                color: 'green'
            };
        } else if (sf >= this.safetyFactors.good) {
            return {
                level: 'safe',
                message: 'Très bien ! Le support est solide.',
                color: 'green'
            };
        } else if (sf >= this.safetyFactors.acceptable) {
            return {
                level: 'warning',
                message: 'Acceptable mais fragile.',
                color: 'orange'
            };
        } else {
            return {
                level: 'danger',
                message: 'Dangereux ! Le support va casser.',
                color: 'red'
            };
        }
    }

    generateRecommendation(safety, stressAnalysis, weight) {
        const sf = stressAnalysis.safetyFactor;

        if (safety.level === 'safe') {
            if (sf > 5) {
                return `🌟 Parfait ! Ton support peut supporter ${weight}kg sans problème. Il est même sur-dimensionné - tu pourrais peut-être optimiser le design pour économiser du plastique !`;
            } else {
                return `✅ Super ! Ton support peut supporter ${weight}kg en toute sécurité. Le facteur de sécurité est de ${sf.toFixed(2)}.`;
            }
        } else if (safety.level === 'warning') {
            return `⚠️ Attention ! Ton support peut supporter ${weight}kg mais c'est limite. Le point critique est : ${stressAnalysis.criticalPointName}. Conseil : augmente l'épaisseur à cet endroit ou réduis le poids.`;
        } else {
            const maxSafeWeight = (weight * sf * 0.8).toFixed(1); // 80% pour marge de sécurité
            return `❌ Ton support va casser avec ${weight}kg ! La rupture se produira au niveau : ${stressAnalysis.criticalPointName}. Poids maximum recommandé : ${maxSafeWeight}kg. Suggestions : renforce la structure, augmente l'épaisseur, ou ajoute des nervures de renfort.`;
        }
    }

    // Méthode utilitaire pour simuler avec différents poids
    findMaxWeight(geometry, position, maxWeight = 20, step = 0.5) {
        let currentWeight = 0;
        let lastSafeWeight = 0;

        while (currentWeight <= maxWeight) {
            const result = this.simulate(geometry, position, currentWeight);
            
            if (result.safety === 'safe') {
                lastSafeWeight = currentWeight;
            } else {
                break;
            }

            currentWeight += step;
        }

        return lastSafeWeight;
    }

    // Analyse de stabilité
    checkStability(geometry, position) {
        const analysis = this.analyzeGeometry(geometry);
        const bbox = analysis.bbox;

        // Vérifier que l'objet est bien positionné sur/dans la table
        const tableHeight = 2.1;
        const isOnTable = bbox.min.y <= tableHeight && bbox.max.y > 0;

        // Calculer le centre de gravité approximatif
        const centerOfMass = bbox.getCenter(new THREE.Vector3());

        // Vérifier l'équilibre
        const baseWidth = Math.max(bbox.max.x - bbox.min.x, bbox.max.z - bbox.min.z);
        const height = bbox.max.y - bbox.min.y;
        const stabilityRatio = baseWidth / height;

        return {
            isOnTable: isOnTable,
            centerOfMass: centerOfMass,
            stabilityRatio: stabilityRatio,
            isStable: stabilityRatio > 0.3 // Ratio minimum pour stabilité
        };
    }
}
