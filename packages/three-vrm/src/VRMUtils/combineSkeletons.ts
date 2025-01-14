import * as THREE from 'three';

/**
 * Traverses the given object and combines the skeletons of skinned meshes.
 *
 * Each frame the bone matrices are computed for every skeleton. Combining skeletons
 * reduces the number of calculations needed, improving performance.
 *
 * @param root Root object that will be traversed
 */
export function combineSkeletons(root: THREE.Object3D): void {
  const skinnedMeshes = collectSkinnedMeshes(root);

  // List all used skin indices for each skin index attribute
  /** A map: skin index attribute -> skin weight attribute -> used index set */
  const attributeUsedIndexSetMap = new Map<
    THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
    Map<THREE.BufferAttribute | THREE.InterleavedBufferAttribute, Set<number>>
  >();
  for (const mesh of skinnedMeshes) {
    const geometry = mesh.geometry;

    const skinIndexAttr = geometry.getAttribute('skinIndex');
    const skinIndexMap = attributeUsedIndexSetMap.get(skinIndexAttr) ?? new Map();
    attributeUsedIndexSetMap.set(skinIndexAttr, skinIndexMap);

    const skinWeightAttr = geometry.getAttribute('skinWeight');
    const usedIndicesSet = listUsedIndices(skinIndexAttr, skinWeightAttr);
    skinIndexMap.set(skinWeightAttr, usedIndicesSet);
  }

  // List all bones and boneInverses for each meshes
  const meshBoneInverseMapMap = new Map<THREE.SkinnedMesh, Map<THREE.Bone, THREE.Matrix4>>();
  for (const mesh of skinnedMeshes) {
    const boneInverseMap = listUsedBones(mesh, attributeUsedIndexSetMap);
    meshBoneInverseMapMap.set(mesh, boneInverseMap);
  }

  // Group meshes by bone sets
  const groups: { boneInverseMap: Map<THREE.Bone, THREE.Matrix4>; meshes: Set<THREE.SkinnedMesh> }[] = [];
  for (const [mesh, boneInverseMap] of meshBoneInverseMapMap) {
    let foundMergeableGroup = false;
    for (const candidate of groups) {
      // check if the candidate group is mergeable
      const isMergeable = boneInverseMapIsMergeable(boneInverseMap, candidate.boneInverseMap);

      // if we found a mergeable group, add the mesh to the group
      if (isMergeable) {
        foundMergeableGroup = true;
        candidate.meshes.add(mesh);

        // add lacking bones to the group
        for (const [bone, boneInverse] of boneInverseMap) {
          candidate.boneInverseMap.set(bone, boneInverse);
        }

        break;
      }
    }

    // if we couldn't find a mergeable group, create a new group
    if (!foundMergeableGroup) {
      groups.push({ boneInverseMap, meshes: new Set([mesh]) });
    }
  }

  // prepare new skeletons for each group, and bind them to the meshes
  for (const { boneInverseMap, meshes } of groups) {
    // create a new skeleton
    const newBones = Array.from(boneInverseMap.keys());
    const newBoneInverses = Array.from(boneInverseMap.values());
    const newSkeleton = new THREE.Skeleton(newBones, newBoneInverses);

    // collect skin index attributes and corresponding bone arrays
    const skinIndexBonesPairSet = collectSkinIndexAttrs(meshes);

    // remap skin index attribute
    for (const [skinIndexAttr, bones] of skinIndexBonesPairSet) {
      remapSkinIndexAttribute(skinIndexAttr, bones, newBones);
    }

    // bind the new skeleton to the meshes
    for (const mesh of meshes) {
      mesh.bind(newSkeleton, new THREE.Matrix4());
    }
  }
}

/**
 * Traverse an entire tree and collect skinned meshes.
 */
function collectSkinnedMeshes(scene: THREE.Object3D): Set<THREE.SkinnedMesh> {
  const skinnedMeshes = new Set<THREE.SkinnedMesh>();

  scene.traverse((obj) => {
    if (!(obj as any).isSkinnedMesh) {
      return;
    }

    const skinnedMesh = obj as THREE.SkinnedMesh;
    skinnedMeshes.add(skinnedMesh);
  });

  return skinnedMeshes;
}

/**
 * List all skin indices used by the given geometry.
 * If the skin weight is 0, the index won't be considered as used.
 * @param skinIndexAttr The skin index attribute to list used indices
 * @param skinWeightAttr The skin weight attribute corresponding to the skin index attribute
 */
function listUsedIndices(
  skinIndexAttr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  skinWeightAttr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
): Set<number> {
  const usedIndices = new Set<number>();

  for (let i = 0; i < skinIndexAttr.count; i++) {
    for (let j = 0; j < skinIndexAttr.itemSize; j++) {
      const index = skinIndexAttr.getComponent(i, j);
      const weight = skinWeightAttr.getComponent(i, j);

      if (weight !== 0) {
        usedIndices.add(index);
      }
    }
  }

  return usedIndices;
}

/**
 * List all bones used by the given skinned mesh.
 * @param mesh The skinned mesh to list used bones
 * @param attributeUsedIndexSetMap A map from skin index attribute to the set of used skin indices
 * @returns A map from used bone to the corresponding bone inverse matrix
 */
function listUsedBones(
  mesh: THREE.SkinnedMesh,
  attributeUsedIndexSetMap: Map<
    THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
    Map<THREE.BufferAttribute | THREE.InterleavedBufferAttribute, Set<number>>
  >,
): Map<THREE.Bone, THREE.Matrix4> {
  const boneInverseMap = new Map<THREE.Bone, THREE.Matrix4>();

  const skeleton = mesh.skeleton;

  const geometry = mesh.geometry;
  const skinIndexAttr = geometry.getAttribute('skinIndex');
  const skinWeightAttr = geometry.getAttribute('skinWeight');
  const skinIndexMap = attributeUsedIndexSetMap.get(skinIndexAttr);
  const usedIndicesSet = skinIndexMap?.get(skinWeightAttr);

  if (!usedIndicesSet) {
    throw new Error(
      'Unreachable. attributeUsedIndexSetMap does not know the skin index attribute or the skin weight attribute.',
    );
  }

  for (const index of usedIndicesSet) {
    boneInverseMap.set(skeleton.bones[index], skeleton.boneInverses[index]);
  }

  return boneInverseMap;
}

/**
 * Check if the given bone inverse map is mergeable to the candidate bone inverse map.
 * @param toCheck The bone inverse map to check
 * @param candidate The candidate bone inverse map
 * @returns True if the bone inverse map is mergeable to the candidate bone inverse map
 */
function boneInverseMapIsMergeable(
  toCheck: Map<THREE.Bone, THREE.Matrix4>,
  candidate: Map<THREE.Bone, THREE.Matrix4>,
): boolean {
  for (const [bone, boneInverse] of toCheck.entries()) {
    // if the bone is in the candidate group and the boneInverse is different, it's not mergeable
    const candidateBoneInverse = candidate.get(bone);
    if (candidateBoneInverse != null) {
      if (!matrixEquals(boneInverse, candidateBoneInverse)) {
        return false;
      }
    }
  }

  return true;
}

function remapSkinIndexAttribute(
  attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  oldBones: THREE.Bone[],
  newBones: THREE.Bone[],
): void {
  // a map from bone to old index
  const boneOldIndexMap = new Map<THREE.Bone, number>();
  for (const bone of oldBones) {
    boneOldIndexMap.set(bone, boneOldIndexMap.size);
  }

  // a map from old skin index to new skin index
  const oldToNew = new Map<number, number>();
  for (const [i, bone] of newBones.entries()) {
    const oldIndex = boneOldIndexMap.get(bone)!;
    oldToNew.set(oldIndex, i);
  }

  // replace the skin index attribute with new indices
  for (let i = 0; i < attribute.count; i++) {
    for (let j = 0; j < attribute.itemSize; j++) {
      const oldIndex = attribute.getComponent(i, j);
      const newIndex = oldToNew.get(oldIndex)!;
      attribute.setComponent(i, j, newIndex);
    }
  }

  attribute.needsUpdate = true;
}

// https://github.com/mrdoob/three.js/blob/r170/test/unit/src/math/Matrix4.tests.js#L12
function matrixEquals(a: THREE.Matrix4, b: THREE.Matrix4, tolerance?: number) {
  tolerance = tolerance || 0.0001;
  if (a.elements.length != b.elements.length) {
    return false;
  }

  for (let i = 0, il = a.elements.length; i < il; i++) {
    const delta = Math.abs(a.elements[i] - b.elements[i]);
    if (delta > tolerance) {
      return false;
    }
  }

  return true;
}

/**
 * Check if the contents of two arrays are equal.
 */
function arrayEquals<T>(a: T[], b: T[]): boolean {
  if (a.length !== b.length) {
    return false;
  }

  return a.every((v, i) => v === b[i]);
}

/**
 * Collect skin index attributes and corresponding bone arrays from the given skinned meshes.
 * If a skin index attribute is shared among different bone sets, clone the attribute.
 */
function collectSkinIndexAttrs(
  meshes: Iterable<THREE.SkinnedMesh>,
): Set<[THREE.BufferAttribute | THREE.InterleavedBufferAttribute, THREE.Bone[]]> {
  const skinIndexBonesPairSet = new Set<[THREE.BufferAttribute | THREE.InterleavedBufferAttribute, THREE.Bone[]]>();

  // Collect skin index attributes
  // skinIndex attribute might be shared among different bone sets
  // If there are multiple bone sets that share the same skinIndex attribute, clone the attribute
  const skinIndexNewSkinIndexBonesMapMap = new Map<
    THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
    Map<THREE.BufferAttribute | THREE.InterleavedBufferAttribute, THREE.Bone[]>
  >();

  for (const mesh of meshes) {
    let skinIndexAttr = mesh.geometry.getAttribute('skinIndex');

    // Get or create a map for the skin index attribute
    let newSkinIndexBonesMap = skinIndexNewSkinIndexBonesMapMap.get(skinIndexAttr);
    if (newSkinIndexBonesMap == null) {
      // Create a new map for the skin index attribute and register the bone array
      newSkinIndexBonesMap = new Map();
      skinIndexNewSkinIndexBonesMapMap.set(skinIndexAttr, newSkinIndexBonesMap);
      newSkinIndexBonesMap.set(skinIndexAttr, mesh.skeleton.bones);
      skinIndexBonesPairSet.add([skinIndexAttr, mesh.skeleton.bones]);
      continue;
    }

    // Check if the bone set is already registered
    for (const bones of newSkinIndexBonesMap.values()) {
      if (arrayEquals(bones, mesh.skeleton.bones)) {
        continue;
      }
    }

    // There is no matching bone set, so clone the skin index attribute
    skinIndexAttr = skinIndexAttr.clone();
    mesh.geometry.setAttribute('skinIndex', skinIndexAttr);
    newSkinIndexBonesMap.set(skinIndexAttr, mesh.skeleton.bones);
    skinIndexBonesPairSet.add([skinIndexAttr, mesh.skeleton.bones]);
  }

  return skinIndexBonesPairSet;
}
