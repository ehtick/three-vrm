import * as THREE from 'three';
import { BufferAttribute } from 'three';

/**
 * Checks which vertices are used by the index attribute.
 * @param attributes Geometry attributes
 * @param originalIndex Original index attribute
 * @returns Vertex usage map and counts
 */
function checkIsVertexUsed(
  attributes: THREE.BufferGeometry['attributes'],
  originalIndex: THREE.BufferAttribute,
): {
  isVertexUsed: boolean[];
  vertexCount: number;
  verticesUsed: number;
} {
  // determine which vertices are used in the geometry
  const vertexCount = Object.values(attributes)[0].count;
  const isVertexUsed = new Array(vertexCount) as boolean[];
  let verticesUsed = 0;

  const originalIndexArray = originalIndex.array;
  for (let i = 0; i < originalIndexArray.length; i++) {
    const index = originalIndexArray[i];
    if (!isVertexUsed[index]) {
      isVertexUsed[index] = true;
      verticesUsed++;
    }
  }

  return { isVertexUsed, vertexCount, verticesUsed };
}

/**
 * Builds index maps from the vertex usage map.
 * @param isVertexUsed Vertex usage map
 * @returns Index maps
 */
function buildIndexMapsFromIsVertexUsed(isVertexUsed: boolean[]): {
  originalIndexNewIndexMap: number[];
  newIndexOriginalIndexMap: number[];
} {
  /** from original index to new index */
  const originalIndexNewIndexMap: number[] = [];

  /** from new index to original index */
  const newIndexOriginalIndexMap: number[] = [];

  // assign new indices
  let indexHead = 0;
  for (let i = 0; i < isVertexUsed.length; i++) {
    if (isVertexUsed[i]) {
      const newIndex = indexHead++;
      originalIndexNewIndexMap[i] = newIndex;
      newIndexOriginalIndexMap[newIndex] = i;
    }
  }

  return { originalIndexNewIndexMap, newIndexOriginalIndexMap };
}

/**
 * Copies geometry properties that are not part of attributes or indices.
 * @param source Source geometry
 * @param target Target geometry
 */
function copyGeometryProperties(source: THREE.BufferGeometry, target: THREE.BufferGeometry): void {
  // Ref: https://github.com/mrdoob/three.js/blob/1a241ef10048770d56e06d6cd6a64c76cc720f95/src/core/BufferGeometry.js#L1011
  target.name = source.name;

  target.morphTargetsRelative = source.morphTargetsRelative;

  source.groups.forEach((group) => {
    target.addGroup(group.start, group.count, group.materialIndex);
  });

  target.boundingBox = source.boundingBox?.clone() ?? null;
  target.boundingSphere = source.boundingSphere?.clone() ?? null;

  target.setDrawRange(source.drawRange.start, source.drawRange.count);

  target.userData = source.userData;
}

/**
 * Rebuilds index attribute based on the original-to-new index map.
 * @param newGeometry New geometry
 * @param originalIndex Original index attribute
 * @param originalIndexNewIndexMap Map from original index to new index
 */
function reorganizeIndexAttribute(
  newGeometry: THREE.BufferGeometry,
  originalIndex: THREE.BufferAttribute,
  originalIndexNewIndexMap: number[],
): void {
  const originalIndexArray = originalIndex.array;
  const newIndexArray = new (originalIndexArray.constructor as any)(originalIndexArray.length);

  for (let i = 0; i < originalIndexArray.length; i++) {
    const index = originalIndexArray[i];
    newIndexArray[i] = originalIndexNewIndexMap[index];
  }

  newGeometry.setIndex(new BufferAttribute(newIndexArray, originalIndex.itemSize, originalIndex.normalized));
}

/**
 * Rebuilds all geometry attributes based on the new-to-original index map.
 * @param newGeometry New geometry
 * @param attributes Original geometry attributes
 * @param newIndexOriginalIndexMap Map from new index to original index
 */
function reorganizeGeometryAttributes(
  newGeometry: THREE.BufferGeometry,
  attributes: THREE.BufferGeometry['attributes'],
  newIndexOriginalIndexMap: number[],
): void {
  Object.keys(attributes).forEach((attributeName) => {
    const originalAttribute = attributes[attributeName] as THREE.BufferAttribute;

    if ((originalAttribute as any).isInterleavedBufferAttribute) {
      throw new Error('removeUnnecessaryVertices: InterleavedBufferAttribute is not supported');
    }

    const originalAttributeArray = originalAttribute.array;
    const { itemSize, normalized } = originalAttribute;

    // eslint-disable-next-line @typescript-eslint/naming-convention
    const ArrayCtor = originalAttributeArray.constructor as THREE.TypedArrayConstructor;
    const newAttributeArray = new ArrayCtor(newIndexOriginalIndexMap.length * itemSize);

    newIndexOriginalIndexMap.forEach((originalIndex, i) => {
      for (let j = 0; j < itemSize; j++) {
        newAttributeArray[i * itemSize + j] = originalAttributeArray[originalIndex * itemSize + j];
      }
    });

    newGeometry.setAttribute(attributeName, new BufferAttribute(newAttributeArray, itemSize, normalized));
  });
}

/**
 * Rebuilds morph attributes based on the new-to-original index map.
 * If all morph attribute values are zero, all morph attributes will be discarded.
 * @param newGeometry New geometry
 * @param morphAttributes Original morph attributes
 * @param newIndexOriginalIndexMap Map from new index to original index
 */
function reorganizeMorphAttributes(
  newGeometry: THREE.BufferGeometry,
  morphAttributes: THREE.BufferGeometry['morphAttributes'],
  newIndexOriginalIndexMap: number[],
): void {
  const newMorphAttributes: THREE.BufferGeometry['morphAttributes'] = {};

  /** True if all morph attribute values are zero */
  let allMorphsAreZero = true;

  for (const [key, attributes] of Object.entries(morphAttributes)) {
    const attributeName = key as keyof typeof morphAttributes;
    newMorphAttributes[attributeName] = [];

    for (let iMorph = 0; iMorph < attributes.length; iMorph++) {
      const originalAttribute = attributes[iMorph] as THREE.BufferAttribute;

      if ((originalAttribute as any).isInterleavedBufferAttribute) {
        throw new Error('removeUnnecessaryVertices: InterleavedBufferAttribute is not supported');
      }

      const originalAttributeArray = originalAttribute.array;
      const { itemSize, normalized } = originalAttribute;

      // eslint-disable-next-line @typescript-eslint/naming-convention
      const ArrayCtor = originalAttributeArray.constructor as THREE.TypedArrayConstructor;
      const newAttributeArray = new ArrayCtor(newIndexOriginalIndexMap.length * itemSize);

      newIndexOriginalIndexMap.forEach((originalIndex, i) => {
        for (let j = 0; j < itemSize; j++) {
          const value = originalAttributeArray[originalIndex * itemSize + j];
          newAttributeArray[i * itemSize + j] = value;
          allMorphsAreZero = allMorphsAreZero && value === 0;
        }
      });

      newMorphAttributes[attributeName][iMorph] = new BufferAttribute(newAttributeArray, itemSize, normalized);
    }
  }

  // discard morph attributes if all values are zero
  newGeometry.morphAttributes = allMorphsAreZero ? {} : newMorphAttributes;
}

/**
 * Traverse given object and remove unnecessary vertices from every BufferGeometries.
 * This only processes buffer geometries with index buffer.
 *
 * Certain models have vertices that are not used by any faces.
 * Three.js creates morph textures for each geometries and it sometimes consumes unnecessary amount of VRAM for certain models.
 * This function will optimize geometries to reduce the size of morph texture.
 * See: https://github.com/mrdoob/three.js/issues/23095
 *
 * @param root Root object that will be traversed
 */
export function removeUnnecessaryVertices(root: THREE.Object3D): void {
  const geometryMap = new Map<THREE.BufferGeometry, THREE.BufferGeometry>();

  // Traverse an entire tree
  root.traverse((obj) => {
    if (!(obj as any).isMesh) {
      return;
    }

    const mesh = obj as THREE.Mesh;
    const geometry = mesh.geometry;

    // if the geometry does not have an index buffer it does not need to be processed
    const originalIndex = geometry.index;
    if (originalIndex == null) {
      return;
    }

    // if the geometry has already been processed, reuse it
    const newGeometryAlreadyExisted = geometryMap.get(geometry);
    if (newGeometryAlreadyExisted != null) {
      mesh.geometry = newGeometryAlreadyExisted;
      return;
    }

    // check which vertices are used
    const { isVertexUsed, vertexCount, verticesUsed } = checkIsVertexUsed(geometry.attributes, originalIndex);

    // if all vertices are used, do nothing
    if (verticesUsed === vertexCount) {
      return;
    }

    // build index maps
    const { originalIndexNewIndexMap, newIndexOriginalIndexMap } = buildIndexMapsFromIsVertexUsed(isVertexUsed);

    // this is the new geometry we will build
    const newGeometry = new THREE.BufferGeometry();
    copyGeometryProperties(geometry, newGeometry);

    // set to geometryMap for later reuse
    geometryMap.set(geometry, newGeometry);

    // reorganize indices and attributes
    reorganizeIndexAttribute(newGeometry, originalIndex, originalIndexNewIndexMap);
    reorganizeGeometryAttributes(newGeometry, geometry.attributes, newIndexOriginalIndexMap);
    reorganizeMorphAttributes(newGeometry, geometry.morphAttributes, newIndexOriginalIndexMap);

    // finally, set the new geometry to the mesh
    mesh.geometry = newGeometry;
  });

  Array.from(geometryMap.keys()).forEach((originalGeometry) => {
    originalGeometry.dispose();
  });
}
