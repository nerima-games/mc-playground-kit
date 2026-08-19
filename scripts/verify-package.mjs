import * as packageExports from '../dist/index.js'

const requiredExports = [
  'AIR_BLOCK_ID',
  'FLUID_KINDS',
  'GameplayServicesLayer',
  'applyAnvil',
  'breakBlock',
  'blockIdOf',
  'blockIdsWithOpacity',
  'blockReaderOf',
  'blockReaderOfChunkWorld',
  'blockCollisionAt',
  'blockCollisionFor',
  'blockCollisionsIn',
  'blockContactAt',
  'blockContactDamageIn',
  'blockContactsIn',
  'blockFluidAt',
  'blockFluidsIn',
  'blockLightSourceAt',
  'blockLightSourcesIn',
  'craftFromGrid',
  'createContainer',
  'emptyEquipment',
  'encodeChunk',
  'explodeBlockWorld',
  'makeControllableSimStagesWithPhysics',
  'makeGameLoop',
  'makeInventoryService',
  'makeSimStages',
  'makeSimStagesForPreview',
  'makeSimStagesForPreviewWithPhysics',
  'makeSimStagesWithPhysics',
  'launchPlayground',
  'makeBrowserPreview',
  'normalizeLaunchOptions',
  'placeBlock',
  'plantCrop',
  'raycastArrowInWorld',
  'readBlockAt',
  'resolvedBlockOfId',
  'resolveOptionsForBlockSource',
  'simModule',
  'summonWitherInBlockWorld',
  'targetBlock',
  'transferContainerItem',
  'transferItemsToFurnace',
  'physics',
  'save',
  'worldgen',
]

const missingExports = requiredExports.filter((name) => !(name in packageExports))

if (missingExports.length > 0) {
  throw new Error(`Package export smoke failed; missing: ${missingExports.join(', ')}`)
}

const requiredWorldgenExports = [
  'ChunkStore',
  'computeChunkLights',
  'generateChunk',
  'generateChunkAt',
  'updateChunkLights',
]
const worldgenExports = packageExports.worldgen

if (worldgenExports === undefined || typeof worldgenExports !== 'object') {
  throw new Error('Package worldgen export smoke failed; missing namespace')
}

const missingWorldgenExports = requiredWorldgenExports.filter(
  (name) => !(name in worldgenExports),
)

if (missingWorldgenExports.length > 0) {
  throw new Error(
    `Package worldgen export smoke failed; missing: ${missingWorldgenExports.join(', ')}`,
  )
}

const namespaceRequirements = [
  ['physics', ['resolveWorld', 'stepWorld', 'voxelRaycast']],
  ['save', ['decodeSave', 'defineFormat', 'encodeSave']],
]

for (const [namespaceName, requiredNames] of namespaceRequirements) {
  const namespaceExports = packageExports[namespaceName]

  if (namespaceExports === undefined || typeof namespaceExports !== 'object') {
    throw new Error(`Package ${namespaceName} export smoke failed; missing namespace`)
  }

  const missingNames = requiredNames.filter((name) => !(name in namespaceExports))

  if (missingNames.length > 0) {
    throw new Error(
      `Package ${namespaceName} export smoke failed; missing: ${missingNames.join(', ')}`,
    )
  }
}

console.log(`Package export smoke passed: ${Object.keys(packageExports).length} runtime exports`)
