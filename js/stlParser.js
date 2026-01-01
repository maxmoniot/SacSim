// Parser de fichiers STL (binaire et ASCII)
class STLParser {
    static parse(arrayBuffer) {
        const dataView = new DataView(arrayBuffer);
        
        // Vérifier si c'est un fichier binaire ou ASCII
        const isBinary = this.isBinarySTL(arrayBuffer);
        
        if (isBinary) {
            return this.parseBinary(dataView);
        } else {
            return this.parseASCII(arrayBuffer);
        }
    }

    static isBinarySTL(arrayBuffer) {
        const dataView = new DataView(arrayBuffer);
        
        // Un fichier STL binaire commence par un header de 80 bytes
        // suivi d'un uint32 indiquant le nombre de triangles
        if (arrayBuffer.byteLength < 84) {
            return false;
        }

        // Lire le nombre de triangles
        const numTriangles = dataView.getUint32(80, true);
        
        // La taille attendue est : 80 (header) + 4 (count) + numTriangles * 50
        const expectedSize = 84 + numTriangles * 50;
        
        // Si la taille correspond, c'est probablement binaire
        if (Math.abs(arrayBuffer.byteLength - expectedSize) < 10) {
            return true;
        }

        // Sinon, vérifier si c'est du texte ASCII
        const header = new TextDecoder().decode(new Uint8Array(arrayBuffer, 0, Math.min(100, arrayBuffer.byteLength)));
        return !header.toLowerCase().includes('solid');
    }

    static parseBinary(dataView) {
        // Skip header (80 bytes)
        const numTriangles = dataView.getUint32(80, true);
        
        const vertices = [];
        const normals = [];

        let offset = 84; // Start after header and triangle count

        for (let i = 0; i < numTriangles; i++) {
            // Normal vector (3 floats)
            const nx = dataView.getFloat32(offset, true);
            const ny = dataView.getFloat32(offset + 4, true);
            const nz = dataView.getFloat32(offset + 8, true);
            offset += 12;

            // Vertex 1
            const v1x = dataView.getFloat32(offset, true);
            const v1y = dataView.getFloat32(offset + 4, true);
            const v1z = dataView.getFloat32(offset + 8, true);
            offset += 12;

            // Vertex 2
            const v2x = dataView.getFloat32(offset, true);
            const v2y = dataView.getFloat32(offset + 4, true);
            const v2z = dataView.getFloat32(offset + 8, true);
            offset += 12;

            // Vertex 3
            const v3x = dataView.getFloat32(offset, true);
            const v3y = dataView.getFloat32(offset + 4, true);
            const v3z = dataView.getFloat32(offset + 8, true);
            offset += 12;

            // Skip attribute byte count (2 bytes)
            offset += 2;

            // Add vertices
            vertices.push(v1x, v1y, v1z);
            vertices.push(v2x, v2y, v2z);
            vertices.push(v3x, v3y, v3z);

            // Add normals (same for all 3 vertices of the triangle)
            normals.push(nx, ny, nz);
            normals.push(nx, ny, nz);
            normals.push(nx, ny, nz);
        }

        // Create BufferGeometry
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));

        return geometry;
    }

    static parseASCII(arrayBuffer) {
        const text = new TextDecoder().decode(arrayBuffer);
        const lines = text.split('\n');
        
        const vertices = [];
        const normals = [];
        
        let currentNormal = null;
        let vertexCount = 0;

        for (let line of lines) {
            line = line.trim();
            
            if (line.startsWith('facet normal')) {
                const parts = line.split(/\s+/);
                currentNormal = [
                    parseFloat(parts[2]),
                    parseFloat(parts[3]),
                    parseFloat(parts[4])
                ];
                vertexCount = 0;
            } else if (line.startsWith('vertex')) {
                const parts = line.split(/\s+/);
                const x = parseFloat(parts[1]);
                const y = parseFloat(parts[2]);
                const z = parseFloat(parts[3]);
                
                vertices.push(x, y, z);
                
                if (currentNormal) {
                    normals.push(currentNormal[0], currentNormal[1], currentNormal[2]);
                }
                
                vertexCount++;
            }
        }

        // Create BufferGeometry
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        
        if (normals.length > 0) {
            geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
        } else {
            geometry.computeVertexNormals();
        }

        return geometry;
    }

    // Méthode utilitaire pour valider un fichier STL
    static validate(geometry) {
        const positions = geometry.attributes.position;
        
        if (!positions || positions.count === 0) {
            throw new Error('Le fichier STL est vide ou invalide');
        }

        if (positions.count % 3 !== 0) {
            throw new Error('Le nombre de vertices n\'est pas un multiple de 3');
        }

        // Vérifier qu'il n'y a pas de NaN ou Infinity
        for (let i = 0; i < positions.count; i++) {
            const x = positions.getX(i);
            const y = positions.getY(i);
            const z = positions.getZ(i);
            
            if (!isFinite(x) || !isFinite(y) || !isFinite(z)) {
                throw new Error('Le fichier contient des valeurs invalides');
            }
        }

        return true;
    }

    // Méthode pour obtenir des statistiques sur le fichier
    static getStats(geometry) {
        const positions = geometry.attributes.position;
        const triangleCount = positions.count / 3;

        // Calculer la boîte englobante
        geometry.computeBoundingBox();
        const bbox = geometry.boundingBox;
        const size = new THREE.Vector3();
        bbox.getSize(size);

        return {
            triangleCount: triangleCount,
            vertexCount: positions.count,
            dimensions: {
                x: size.x,
                y: size.y,
                z: size.z
            },
            boundingBox: bbox
        };
    }

    // Méthode pour optimiser la géométrie
    static optimize(geometry) {
        // Supprimer les vertices dupliqués
        const tolerance = 0.0001;
        
        // Cette opération peut être coûteuse, on la simplifie
        geometry.computeVertexNormals();
        
        return geometry;
    }

    // Méthode pour exporter en STL ASCII
    static exportASCII(geometry, name = 'model') {
        const positions = geometry.attributes.position;
        const normals = geometry.attributes.normal || null;
        
        let output = `solid ${name}\n`;

        for (let i = 0; i < positions.count; i += 3) {
            // Normal
            if (normals) {
                const nx = normals.getX(i);
                const ny = normals.getY(i);
                const nz = normals.getZ(i);
                output += `  facet normal ${nx.toExponential()} ${ny.toExponential()} ${nz.toExponential()}\n`;
            } else {
                output += `  facet normal 0 0 0\n`;
            }
            
            output += `    outer loop\n`;
            
            // Vertices
            for (let j = 0; j < 3; j++) {
                const x = positions.getX(i + j);
                const y = positions.getY(i + j);
                const z = positions.getZ(i + j);
                output += `      vertex ${x.toExponential()} ${y.toExponential()} ${z.toExponential()}\n`;
            }
            
            output += `    endloop\n`;
            output += `  endfacet\n`;
        }

        output += `endsolid ${name}\n`;
        
        return output;
    }

    // Méthode pour exporter en STL binaire
    static exportBinary(geometry) {
        const positions = geometry.attributes.position;
        const normals = geometry.attributes.normal || null;
        
        const triangleCount = positions.count / 3;
        
        // Taille totale : 80 (header) + 4 (count) + triangleCount * 50
        const bufferSize = 84 + triangleCount * 50;
        const buffer = new ArrayBuffer(bufferSize);
        const dataView = new DataView(buffer);
        
        // Header (80 bytes) - rempli de zéros
        // Nombre de triangles
        dataView.setUint32(80, triangleCount, true);
        
        let offset = 84;
        
        for (let i = 0; i < positions.count; i += 3) {
            // Normal
            if (normals) {
                dataView.setFloat32(offset, normals.getX(i), true);
                dataView.setFloat32(offset + 4, normals.getY(i), true);
                dataView.setFloat32(offset + 8, normals.getZ(i), true);
            } else {
                dataView.setFloat32(offset, 0, true);
                dataView.setFloat32(offset + 4, 0, true);
                dataView.setFloat32(offset + 8, 0, true);
            }
            offset += 12;
            
            // Vertices
            for (let j = 0; j < 3; j++) {
                dataView.setFloat32(offset, positions.getX(i + j), true);
                dataView.setFloat32(offset + 4, positions.getY(i + j), true);
                dataView.setFloat32(offset + 8, positions.getZ(i + j), true);
                offset += 12;
            }
            
            // Attribute byte count (2 bytes) - 0
            dataView.setUint16(offset, 0, true);
            offset += 2;
        }
        
        return buffer;
    }

    // Méthode pour créer un blob téléchargeable
    static createDownloadBlob(geometry, format = 'binary') {
        let blob;
        
        if (format === 'binary') {
            const buffer = this.exportBinary(geometry);
            blob = new Blob([buffer], { type: 'application/octet-stream' });
        } else {
            const text = this.exportASCII(geometry);
            blob = new Blob([text], { type: 'text/plain' });
        }
        
        return blob;
    }
}

// Export pour utilisation dans d'autres modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = STLParser;
}
