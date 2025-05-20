import * as THREE from 'three/webgpu';
import { float, modelViewPosition, NodeRepresentation, transformedNormalView } from 'three/tsl';
import { FnCompat } from './utils/FnCompat';

export const mtoonParametricRim = FnCompat(
  ({
    parametricRimLift,
    parametricRimFresnelPower,
    parametricRimColor,
  }: {
    parametricRimLift: NodeRepresentation;
    parametricRimFresnelPower: NodeRepresentation;
    parametricRimColor: NodeRepresentation;
  }) => {
    const viewDir = modelViewPosition.normalize();
    const dotNV = transformedNormalView.dot(viewDir.negate());

    const rim = float(1.0).sub(dotNV).add(parametricRimLift).clamp().pow(parametricRimFresnelPower);

    return rim.mul(parametricRimColor);
  },
);
