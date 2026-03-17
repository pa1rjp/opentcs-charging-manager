import { AppConfig } from './schema'

export const DEFAULT_CONFIG: AppConfig = {
  thresholds: {
    critical: 30,
    good: 50,
    sufficient: 80,
    full: 98,
  },
  chargers: [
    {
      name: 'ChargingStation-1',
      locationName: 'ChargingStation-1',
      operation: 'CHARGE',
    },
    {
      name: 'ChargingStation-2',
      locationName: 'ChargingStation-2',
      operation: 'CHARGE',
    },
  ],
  vehicles: [
    {
      name: 'Vehicle-0001',
      preferredCharger: 'ChargingStation-1',
      preferredParkingPoint: 'ParkingPoint-0001',
    },
    {
      name: 'Vehicle-0002',
      preferredCharger: 'ChargingStation-1',
      preferredParkingPoint: 'ParkingPoint-0002',
    },
    {
      name: 'Vehicle-0003',
      preferredCharger: 'ChargingStation-2',
      preferredParkingPoint: 'ParkingPoint-0003',
    },
    {
      name: 'Vehicle-0004',
      preferredCharger: 'ChargingStation-2',
      preferredParkingPoint: 'ParkingPoint-0004',
    },
  ],
  pollIntervalMs: 10000,
  engineEnabled: true,
}
