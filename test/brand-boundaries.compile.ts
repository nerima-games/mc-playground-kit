import { ChunkKey, type Position, position } from '@nerima-games/mc-kernel'
import { CentreY, FootY, HalfHeight } from '@nerima-games/mc-physics'
import { SaveKey } from '@nerima-games/mc-save'
import { EntityId, EntityKind } from '@nerima-games/mc-sim'
import { chunkCoord, type ChunkCoord } from '@nerima-games/mc-worldgen'

const kernelChunkKey = ChunkKey('0,0')
const kernelPosition: Position = position(0, 0, 0)
const physicsFootY = FootY(0)
const physicsCentreY = CentreY(0)
const physicsHalfHeight = HalfHeight(0.5)
const saveKey = SaveKey('world/overworld')
const simEntityId = EntityId('e:1')
const simEntityKind = EntityKind('player')
const worldgenChunkCoord: ChunkCoord = chunkCoord(0, 0)

const acceptsKernelChunkKey = (value: typeof kernelChunkKey): void => {
  void value
}
const acceptsKernelPosition = (value: Position): void => {
  void value
}
const acceptsPhysicsFootY = (value: typeof physicsFootY): void => {
  void value
}
const acceptsPhysicsCentreY = (value: typeof physicsCentreY): void => {
  void value
}
const acceptsPhysicsHalfHeight = (value: typeof physicsHalfHeight): void => {
  void value
}
const acceptsSaveKey = (value: typeof saveKey): void => {
  void value
}
const acceptsWorldgenChunkCoord = (value: ChunkCoord): void => {
  void value
}
const acceptsSimEntityId = (value: typeof simEntityId): void => {
  void value
}
const acceptsSimEntityKind = (value: typeof simEntityKind): void => {
  void value
}

acceptsKernelChunkKey(kernelChunkKey)
acceptsKernelPosition(kernelPosition)
acceptsPhysicsFootY(physicsFootY)
acceptsPhysicsCentreY(physicsCentreY)
acceptsPhysicsHalfHeight(physicsHalfHeight)
acceptsSaveKey(saveKey)
acceptsWorldgenChunkCoord(worldgenChunkCoord)
acceptsSimEntityId(simEntityId)
acceptsSimEntityKind(simEntityKind)

// These negative controls keep package brands from becoming structurally interchangeable.
// @ts-expect-error A kernel chunk key is not an arbitrary string.
acceptsKernelChunkKey('0,0')
// @ts-expect-error A kernel position is not a physics foot height.
acceptsPhysicsFootY(kernelPosition.x)
// @ts-expect-error A centre height cannot be used where a foot height is required.
acceptsPhysicsFootY(physicsCentreY)
// @ts-expect-error A save key is not a kernel chunk key.
acceptsKernelChunkKey(saveKey)
// @ts-expect-error A worldgen chunk coordinate is not a kernel position.
acceptsKernelPosition(worldgenChunkCoord)
// @ts-expect-error A plain string is not a save key.
acceptsSaveKey('world/overworld')
// @ts-expect-error A sim entity id is not a sim entity kind.
acceptsSimEntityKind(simEntityId)
// @ts-expect-error A kernel chunk key is not a sim entity id.
acceptsSimEntityId(kernelChunkKey)
