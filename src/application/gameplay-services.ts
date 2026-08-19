import {
  type BehaviourRepair,
  type EntityRoster,
  EquipmentServiceLayer,
  EntityManagerLayer as entityManagerLayer,
  SettingsServiceLayer as settingsServiceLayer,
  simModule,
  StatisticsServiceLayer as statisticsServiceLayer,
  VehicleServiceLayer as vehicleServiceLayer,
  VitalsServiceLayer as vitalsServiceLayer,
  WeatherServiceLayer as weatherServiceLayer,
} from '@nerima-games/mc-sim'
import { Layer } from 'effect'

export const GameplayServicesLayer = Layer.mergeAll(
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
) => Layer.mergeAll(
  GameplayServicesLayer,
  entityManagerLayer(initial, repairBehaviour),
)
