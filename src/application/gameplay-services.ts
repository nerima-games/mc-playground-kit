import {
  type BehaviourRepair,
  type CropService,
  type EntityManager,
  type EntityRoster,
  type EquipmentService,
  EquipmentServiceLayer,
  type InventoryService,
  type PlayerService,
  type SettingsService,
  type StatisticsService,
  type TimeService,
  type VehicleService,
  type VitalsService,
  type WeatherService,
  EntityManagerLayer as entityManagerLayer,
  SettingsServiceLayer as settingsServiceLayer,
  simModule,
  StatisticsServiceLayer as statisticsServiceLayer,
  VehicleServiceLayer as vehicleServiceLayer,
  VitalsServiceLayer as vitalsServiceLayer,
  WeatherServiceLayer as weatherServiceLayer,
} from '@nerima-games/mc-sim'
import { Layer } from 'effect'

// The types below are written out explicitly rather than left to inference: TypeScript's `isolatedDeclarations` requires an explicit annotation on any exported const whose initializer is a call expression, and these are exactly what `tsc`'s own inference resolves `Layer.mergeAll(...)` to here.
type GameplayServicesRequirement =
  | CropService
  | EquipmentService
  | InventoryService
  | PlayerService
  | SettingsService
  | StatisticsService
  | TimeService
  | VehicleService
  | VitalsService
  | WeatherService

type GameplayServicesLayerError = Readonly<{
  _tag: 'VehicleValidationError'
  path: string
  reason: string
}>

export const GameplayServicesLayer: Layer.Layer<GameplayServicesRequirement, GameplayServicesLayerError, never> =
  Layer.mergeAll(
    simModule.layers,
    EquipmentServiceLayer,
    vitalsServiceLayer(),
    weatherServiceLayer(),
    settingsServiceLayer(),
    statisticsServiceLayer(),
    vehicleServiceLayer(),
  )

export const gameplayServicesLayerWithEntities = <S>(
  initial?: EntityRoster<S>,
  repairBehaviour?: BehaviourRepair<S>,
): Layer.Layer<GameplayServicesRequirement | EntityManager, GameplayServicesLayerError, never> =>
  Layer.mergeAll(GameplayServicesLayer, entityManagerLayer(initial, repairBehaviour))
