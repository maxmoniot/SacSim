// Simulation 2D - Analyse de déformation par coupe latérale
// Basé sur les équations de flexion des poutres (Euler-Bernoulli)

class Simulation2D {
    constructor(container) {
        this.container = container;
        this.canvas = null;
        this.ctx = null;
        this.profile = null; // Profil 2D extrait
        this.sections = []; // Sections pour le calcul
        this.deformation = []; // Résultats de déformation
        
        // Propriétés du matériau PLA
        this.material = {
            E: 3500e6, // Module d'Young en Pa (3500 MPa)
            yieldStrength: 50e6, // Limite élastique en Pa (50 MPa)
            density: 1.25 // g/cm³
        };
        
        // Paramètres de visualisation
        this.scale = 1;
        this.offsetX = 0;
        this.offsetY = 0;
        
        // Animation
        this.animationFrame = null;
        this.currentLoad = 0;
        this.maxLoad = 50; // N (≈5kg)
        this.animationSpeed = 0.5;
        
        this.init();
    }

    init() {
        // Créer le canvas
        this.canvas = document.createElement('canvas');
        this.canvas.width = 300;
        this.canvas.height = 200;
        this.canvas.style.cssText = 'background: #1a1a2e; border-radius: 8px; border: 1px solid #2d3561;';
        this.ctx = this.canvas.getContext('2d');
        
        // Créer le conteneur de la fenêtre 2D
        this.window = document.createElement('div');
        this.window.className = 'simulation-2d-window';
        this.window.innerHTML = `
            <div class="sim2d-header">
                <span>📐 Vue en coupe</span>
                <button class="sim2d-close" title="Fermer">×</button>
            </div>
            <div class="sim2d-content"></div>
            <div class="sim2d-info">
                <span class="sim2d-load">Charge: 0 N</span>
                <span class="sim2d-deform">Déformation: 0 mm</span>
            </div>
        `;
        
        this.window.querySelector('.sim2d-content').appendChild(this.canvas);
        this.window.querySelector('.sim2d-close').addEventListener('click', () => this.hide());
        
        this.container.appendChild(this.window);
        this.hide(); // Caché par défaut
    }

    show() {
        this.window.style.display = 'block';
    }

    hide() {
        this.window.style.display = 'none';
        this.stopAnimation();
    }

    /**
     * Extraire le profil 2D depuis la géométrie 3D
     * On fait une coupe au milieu (Z = centre) et on projette sur XY
     */
    extractProfile(geometry, meshPosition, meshRotation, tableThickness) {
        console.log('📐 Extraction du profil 2D...');
        
        const positions = geometry.attributes.position;
        const points = [];
        
        // Collecter tous les points en coordonnées monde
        for (let i = 0; i < positions.count; i++) {
            const v = new THREE.Vector3(
                positions.getX(i),
                positions.getY(i),
                positions.getZ(i)
            );
            v.multiplyScalar(0.1); // Échelle STL
            v.applyEuler(meshRotation);
            v.add(meshPosition);
            
            points.push({ x: v.x, y: v.y, z: v.z });
        }
        
        // Trouver les limites en Z
        const zValues = points.map(p => p.z);
        const zMin = Math.min(...zValues);
        const zMax = Math.max(...zValues);
        const zCenter = (zMin + zMax) / 2;
        const zWidth = zMax - zMin;
        
        console.log('  Z range:', zMin.toFixed(1), 'à', zMax.toFixed(1), '(largeur:', zWidth.toFixed(1), 'cm)');
        
        // Prendre une tranche au centre (±10% de la largeur)
        const sliceThickness = zWidth * 0.2;
        const slicePoints = points.filter(p => 
            Math.abs(p.z - zCenter) < sliceThickness / 2
        );
        
        console.log('  Points dans la tranche:', slicePoints.length);
        
        // Projeter sur XY et trouver le contour
        // On échantillonne par tranches horizontales (Y) pour avoir l'épaisseur à chaque niveau
        const yValues = slicePoints.map(p => p.y);
        const yMin = Math.min(...yValues);
        const yMax = Math.max(...yValues);
        
        const xValues = slicePoints.map(p => p.x);
        const xMin = Math.min(...xValues);
        const xMax = Math.max(...xValues);
        
        // Créer des tranches horizontales
        const numSlices = 50;
        const sliceHeight = (yMax - yMin) / numSlices;
        const profile = [];
        
        for (let i = 0; i <= numSlices; i++) {
            const y = yMin + i * sliceHeight;
            
            // Trouver les points à cette hauteur (±sliceHeight/2)
            const pointsAtY = slicePoints.filter(p => 
                Math.abs(p.y - y) < sliceHeight
            );
            
            if (pointsAtY.length > 0) {
                const xsAtY = pointsAtY.map(p => p.x);
                const xLeft = Math.min(...xsAtY);
                const xRight = Math.max(...xsAtY);
                
                profile.push({
                    y: y,
                    xLeft: xLeft,
                    xRight: xRight,
                    thickness: xRight - xLeft, // Épaisseur à cette hauteur
                    width: zWidth // Largeur en Z (pour le calcul de I)
                });
            }
        }
        
        this.profile = {
            points: profile,
            bounds: { xMin, xMax, yMin, yMax },
            zWidth: zWidth,
            tableThickness: tableThickness
        };
        
        console.log('  Profil extrait:', profile.length, 'sections');
        
        return this.profile;
    }

    /**
     * Analyser la structure : identifier ancrage, pivot, partie libre
     */
    analyzeStructure(hangingPoint) {
        if (!this.profile || !this.profile.points || this.profile.points.length === 0) {
            console.log('⚠️ Pas de profil pour analyser');
            return null;
        }
        
        const tableTop = this.profile.tableThickness;
        const tableEdge = 0; // X = 0 est le bord de table
        
        console.log('📐 Analyse de la structure...');
        console.log('  Épaisseur table:', tableTop, 'cm');
        console.log('  Bord table à X =', tableEdge);
        
        // Séparer les sections
        const anchorSections = []; // Sur/dans la table (ancrées)
        const freeSections = [];   // Partie libre (porte le poids)
        
        this.profile.points.forEach(section => {
            // Une section est ANCRÉE si elle est sur ou dans la table :
            // - Y > épaisseur table ET X < 0 (sur le dessus de la table)
            // - OU 0 < Y < épaisseur table ET X < 0 (dans l'épaisseur)
            const isOnTable = section.y > tableTop && section.xRight < tableEdge;
            const isInTable = section.y >= 0 && section.y <= tableTop && section.xRight < tableEdge;
            
            // Une section est LIBRE si elle dépasse du bord ou est sous la table :
            // - X > 0 (dépasse du bord)
            // - OU Y < 0 (sous la table)
            const isFree = section.xLeft > tableEdge - 1 || section.y < 0;
            
            if (isOnTable || isInTable) {
                anchorSections.push(section);
            } else if (isFree) {
                freeSections.push(section);
            } else {
                // Par défaut, considérer comme libre
                freeSections.push(section);
            }
        });
        
        console.log('  Sections ancrées:', anchorSections.length);
        console.log('  Sections libres:', freeSections.length);
        
        // Si aucune section libre, utiliser toutes les sections sous la table
        if (freeSections.length === 0) {
            console.log('  ⚠️ Aucune section libre détectée, utilisation de toutes les sections');
            this.profile.points.forEach(section => {
                if (section.y < tableTop) {
                    freeSections.push(section);
                }
            });
            console.log('  Sections libres (fallback):', freeSections.length);
        }
        
        // Point de pivot = bord de table
        const pivot = { x: tableEdge, y: tableTop };
        
        // Bras de levier = distance horizontale du pivot au point d'accrochage
        const leverArm = Math.abs(hangingPoint.x - pivot.x) / 100; // en mètres
        
        this.structure = {
            anchorSections,
            freeSections,
            pivot,
            hangingPoint: { x: hangingPoint.x, y: hangingPoint.y },
            leverArm: Math.max(leverArm, 0.01), // Minimum 1cm
            zWidth: this.profile.zWidth / 100 // en mètres
        };
        
        console.log('  Bras de levier:', (this.structure.leverArm * 100).toFixed(1), 'cm');
        console.log('  Largeur Z:', (this.structure.zWidth * 100).toFixed(1), 'cm');
        
        return this.structure;
    }

    /**
     * Calculer la déformation et les contraintes pour une charge donnée
     * Utilise la théorie des poutres d'Euler-Bernoulli
     */
    calculateDeformation(force) {
        // Initialiser avec des valeurs par défaut
        this.deformation = {
            sections: [],
            maxStress: 0,
            maxDeflection: 0,
            force: force,
            leverArm: 0
        };
        
        if (!this.structure || !this.structure.freeSections || this.structure.freeSections.length === 0) {
            console.log('⚠️ Pas de sections libres pour calculer la déformation');
            return this.deformation;
        }
        
        const E = this.material.E; // Module d'Young
        const sections = this.structure.freeSections;
        const pivot = this.structure.pivot;
        const hangPoint = this.structure.hangingPoint;
        const b = this.structure.zWidth; // Largeur (en m)
        
        const results = [];
        let maxStress = 0;
        let maxDeflection = 0;
        
        sections.forEach((section, i) => {
            // Position de la section
            const x = (section.xLeft + section.xRight) / 2 / 100; // centre X en m
            const y = section.y / 100; // Y en m
            
            // Distance au pivot (le long de la structure)
            const distToPivot = Math.sqrt(
                Math.pow(x - pivot.x / 100, 2) + 
                Math.pow(y - pivot.y / 100, 2)
            );
            
            // Distance au point d'accrochage
            const distToHang = Math.sqrt(
                Math.pow(x - hangPoint.x / 100, 2) + 
                Math.pow(y - hangPoint.y / 100, 2)
            );
            
            // Épaisseur de la section (en m)
            const h = Math.max(section.thickness / 100, 0.002);
            
            // Moment d'inertie I = b * h³ / 12
            const I = (b * Math.pow(h, 3)) / 12;
            
            // Moment de flexion M = F * distance au point de charge
            const M = force * Math.max(distToHang, 0.01);
            
            // Contrainte de flexion σ = M * c / I où c = h/2
            const c = h / 2;
            const stress = I > 0 ? (M * c) / I : 0;
            
            // Déflexion approximative (formule simplifiée pour poutre cantilever)
            const L = Math.max(this.structure.leverArm, 0.01);
            const deflection = I > 0 ? (force * Math.pow(L, 3)) / (3 * E * I) : 0;
            
            // Déflexion locale proportionnelle à la position
            const localDeflection = deflection * (distToPivot / L);
            
            maxStress = Math.max(maxStress, stress);
            maxDeflection = Math.max(maxDeflection, localDeflection);
            
            results.push({
                section,
                x: section.xLeft + section.thickness / 2,
                y: section.y,
                stress: stress / 1e6, // En MPa
                deflection: localDeflection * 1000, // En mm
                moment: M,
                inertia: I,
                distToPivot,
                distToHang
            });
        });
        
        this.deformation = {
            sections: results,
            maxStress: maxStress / 1e6, // MPa
            maxDeflection: maxDeflection * 1000, // mm
            force: force,
            leverArm: this.structure.leverArm * 100 // cm
        };
        
        return this.deformation;
    }

    /**
     * Calculer la charge maximale avant rupture
     */
    calculateMaxLoad() {
        if (!this.structure || !this.structure.freeSections || this.structure.freeSections.length === 0) {
            console.log('⚠️ Pas de structure pour calculer la charge max');
            return 5; // Valeur par défaut
        }
        
        // Trouver la section la plus faible (plus petit I)
        let minI = Infinity;
        let weakestSection = null;
        
        this.structure.freeSections.forEach(section => {
            const h = Math.max(section.thickness / 100, 0.002); // en mètres, min 2mm
            const b = Math.max(this.structure.zWidth, 0.01); // en mètres
            const I = (b * Math.pow(h, 3)) / 12;
            
            if (I < minI && I > 0) {
                minI = I;
                weakestSection = section;
            }
        });
        
        if (!weakestSection || minI === Infinity || minI === 0) {
            console.log('⚠️ Section la plus faible non trouvée');
            return 5;
        }
        
        console.log('📊 Section la plus faible:');
        console.log('  Épaisseur:', weakestSection.thickness.toFixed(2), 'cm');
        console.log('  Position Y:', weakestSection.y.toFixed(2), 'cm');
        console.log('  Inertie I:', minI.toExponential(3), 'm⁴');
        
        // Force max = σ_yield * I / (c * L)
        const h = Math.max(weakestSection.thickness / 100, 0.002);
        const c = h / 2;
        const L = Math.max(this.structure.leverArm, 0.02); // en mètres
        
        // F_max = σ_yield * I / (c * L)
        const F_max = (this.material.yieldStrength * minI) / (c * L);
        
        // Convertir en kg (avec marge de sécurité de 0.6)
        const maxWeight = (F_max / 9.81) * 0.6;
        
        console.log('  Force max:', F_max.toFixed(1), 'N');
        console.log('  Poids max:', maxWeight.toFixed(1), 'kg');
        
        return Math.max(0.5, Math.min(maxWeight, 10));
    }

    /**
     * Dessiner le profil 2D et la déformation
     */
    draw(showDeformation = true) {
        if (!this.profile || !this.ctx) return;
        
        const ctx = this.ctx;
        const canvas = this.canvas;
        
        // Effacer
        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        // Calculer l'échelle
        const bounds = this.profile.bounds;
        const padding = 20;
        const scaleX = (canvas.width - 2 * padding) / (bounds.xMax - bounds.xMin + 10);
        const scaleY = (canvas.height - 2 * padding) / (bounds.yMax - bounds.yMin + 5);
        this.scale = Math.min(scaleX, scaleY) * 0.8;
        
        // Centrer
        this.offsetX = padding - bounds.xMin * this.scale + 30;
        this.offsetY = canvas.height - padding + bounds.yMin * this.scale;
        
        // Fonction de transformation
        const toScreen = (x, y) => ({
            x: this.offsetX + x * this.scale,
            y: this.offsetY - y * this.scale
        });
        
        // Dessiner la table
        ctx.fillStyle = '#8B4513';
        const tableLeft = toScreen(-15, this.profile.tableThickness);
        ctx.fillRect(tableLeft.x, tableLeft.y, 20 * this.scale, this.profile.tableThickness * this.scale);
        
        // Dessiner le bord de table (pivot)
        ctx.strokeStyle = '#FFD700';
        ctx.lineWidth = 2;
        const pivotTop = toScreen(0, this.profile.tableThickness);
        const pivotBottom = toScreen(0, 0);
        ctx.beginPath();
        ctx.moveTo(pivotTop.x, pivotTop.y);
        ctx.lineTo(pivotBottom.x, pivotBottom.y);
        ctx.stroke();
        
        // Dessiner le profil
        if (showDeformation && this.deformation && this.deformation.sections && this.deformation.sections.length > 0) {
            // Avec couleurs de contrainte
            const maxStress = Math.max(this.deformation.maxStress, 1);
            
            this.deformation.sections.forEach(result => {
                const section = result.section;
                
                // Couleur basée sur la contrainte
                const stressRatio = Math.min(1, result.stress / maxStress);
                const color = this.getStressColor(stressRatio);
                
                // Position avec déformation amplifiée
                const deflectionScale = 20;
                const dx = (result.deflection || 0) * deflectionScale;
                
                const p1 = toScreen(section.xLeft + dx, section.y);
                const p2 = toScreen(section.xRight + dx, section.y);
                
                ctx.strokeStyle = color;
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.moveTo(p1.x, p1.y);
                ctx.lineTo(p2.x, p2.y);
                ctx.stroke();
            });
        } else {
            // Sans déformation (profil simple)
            ctx.strokeStyle = '#4CAF50';
            ctx.lineWidth = 2;
            
            this.profile.points.forEach(section => {
                const p1 = toScreen(section.xLeft, section.y);
                const p2 = toScreen(section.xRight, section.y);
                
                ctx.beginPath();
                ctx.moveTo(p1.x, p1.y);
                ctx.lineTo(p2.x, p2.y);
                ctx.stroke();
            });
        }
        
        // Dessiner le point d'accrochage
        if (this.structure && this.structure.hangingPoint) {
            const hp = toScreen(this.structure.hangingPoint.x, this.structure.hangingPoint.y);
            
            ctx.fillStyle = '#FF5722';
            ctx.beginPath();
            ctx.arc(hp.x, hp.y, 5, 0, Math.PI * 2);
            ctx.fill();
            
            // Flèche de force
            ctx.strokeStyle = '#FF5722';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(hp.x, hp.y);
            ctx.lineTo(hp.x, hp.y + 25);
            ctx.stroke();
            
            // Pointe de flèche
            ctx.beginPath();
            ctx.moveTo(hp.x - 4, hp.y + 20);
            ctx.lineTo(hp.x, hp.y + 25);
            ctx.lineTo(hp.x + 4, hp.y + 20);
            ctx.stroke();
        }
        
        // Mettre à jour les infos
        const loadSpan = this.window.querySelector('.sim2d-load');
        const deformSpan = this.window.querySelector('.sim2d-deform');
        
        if (this.deformation && this.deformation.force !== undefined) {
            if (loadSpan) loadSpan.textContent = `Charge: ${this.deformation.force.toFixed(1)} N`;
            if (deformSpan) deformSpan.textContent = `Déform: ${this.deformation.maxDeflection.toFixed(2)} mm`;
        } else {
            if (loadSpan) loadSpan.textContent = `Charge: 0 N`;
            if (deformSpan) deformSpan.textContent = `Déform: 0 mm`;
        }
    }

    /**
     * Couleur basée sur le stress (bleu → vert → jaune → rouge)
     */
    getStressColor(ratio) {
        ratio = Math.max(0, Math.min(1, ratio));
        
        if (ratio < 0.25) {
            // Bleu → Cyan
            const t = ratio / 0.25;
            return `rgb(0, ${Math.floor(t * 255)}, 255)`;
        } else if (ratio < 0.5) {
            // Cyan → Vert
            const t = (ratio - 0.25) / 0.25;
            return `rgb(0, 255, ${Math.floor(255 * (1 - t))})`;
        } else if (ratio < 0.75) {
            // Vert → Jaune
            const t = (ratio - 0.5) / 0.25;
            return `rgb(${Math.floor(t * 255)}, 255, 0)`;
        } else {
            // Jaune → Rouge
            const t = (ratio - 0.75) / 0.25;
            return `rgb(255, ${Math.floor(255 * (1 - t))}, 0)`;
        }
    }

    /**
     * Lancer l'animation de déformation progressive
     */
    startAnimation(onUpdate) {
        this.stopAnimation();
        this.currentLoad = 0;
        
        if (!this.structure || !this.structure.freeSections || this.structure.freeSections.length === 0) {
            console.log('⚠️ Pas de structure pour animer');
            return;
        }
        
        const maxForce = Math.max(this.maxLoad, 1);
        const speed = Math.max(this.animationSpeed, 0.5);
        
        console.log('🎬 Démarrage animation: 0 →', maxForce.toFixed(1), 'N');
        
        const animate = () => {
            this.currentLoad += speed;
            
            if (this.currentLoad > maxForce) {
                this.currentLoad = maxForce;
            }
            
            // Calculer la déformation pour cette charge
            this.calculateDeformation(this.currentLoad);
            this.draw(true);
            
            // Callback pour mettre à jour le 3D
            if (onUpdate && this.deformation) {
                onUpdate(this.deformation);
            }
            
            if (this.currentLoad < maxForce) {
                this.animationFrame = requestAnimationFrame(animate);
            } else {
                console.log('🎬 Animation terminée');
            }
        };
        
        this.animationFrame = requestAnimationFrame(animate);
    }

    stopAnimation() {
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
            this.animationFrame = null;
        }
    }

    /**
     * Obtenir les données de stress pour mapper sur le modèle 3D
     */
    getStressMapFor3D() {
        if (!this.deformation || !this.deformation.sections || this.deformation.sections.length === 0) {
            return null;
        }
        
        // Créer une map Y → stress pour interpoler sur les vertices 3D
        const stressMap = new Map();
        const maxStress = Math.max(this.deformation.maxStress, 0.1);
        
        this.deformation.sections.forEach(result => {
            const yKey = Math.round(result.y * 10) / 10; // Arrondir à 1 décimale
            stressMap.set(yKey, {
                stress: result.stress || 0,
                deflection: result.deflection || 0,
                ratio: Math.min(1, (result.stress || 0) / maxStress)
            });
        });
        
        return {
            map: stressMap,
            maxStress: this.deformation.maxStress,
            maxDeflection: this.deformation.maxDeflection,
            yieldStrength: this.material.yieldStrength / 1e6
        };
    }
}

// CSS pour la fenêtre 2D
const style2D = document.createElement('style');
style2D.textContent = `
.simulation-2d-window {
    position: absolute;
    top: 10px;
    left: 10px;
    background: rgba(26, 26, 46, 0.95);
    border: 1px solid #2d3561;
    border-radius: 8px;
    box-shadow: 0 4px 15px rgba(0,0,0,0.3);
    z-index: 100;
    overflow: hidden;
}

.sim2d-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 12px;
    background: #2d3561;
    color: white;
    font-size: 12px;
    font-weight: bold;
}

.sim2d-close {
    background: none;
    border: none;
    color: white;
    font-size: 16px;
    cursor: pointer;
    padding: 0 5px;
}

.sim2d-close:hover {
    color: #f44336;
}

.sim2d-content {
    padding: 5px;
}

.sim2d-info {
    display: flex;
    justify-content: space-between;
    padding: 5px 10px;
    font-size: 10px;
    color: #a0a0a0;
    border-top: 1px solid #2d3561;
}
`;
document.head.appendChild(style2D);

// Export
window.Simulation2D = Simulation2D;
