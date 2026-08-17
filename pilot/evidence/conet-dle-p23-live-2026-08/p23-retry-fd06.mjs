#!/usr/bin/env node
/** P23 keep-data retry for official standby fd-06 only. Does not wipe. Does not touch EL/CL. */
import {
  DEFAULT_HOSTS_PATH,
  DEFAULT_INVENTORY_PATH,
  deployArchiveRuntime,
  loadLabHosts,
  loadOfficialLabInventory,
  planeDirectoryFromHosts,
} from '../../dist/src/lab.js'
import { DLE_LAB_GROUP_ID, DLE_LAB_M6_GROUP_ID, loadM6Hosts, loadM6Inventory } from '../../dist/src/m6.js'

function mergePlaneDirectories(...rows) {
  const merged = []
  for (const group of rows) {
    if (group === undefined) continue
    merged.push(...group)
  }
  return merged
}

const g1Inventory = await loadOfficialLabInventory(DEFAULT_INVENTORY_PATH)
const g1Hosts = await loadLabHosts(DEFAULT_HOSTS_PATH)
const g2Inventory = await loadM6Inventory()
const g2Hosts = await loadM6Hosts()
const result = await deployArchiveRuntime({
  keepData: true,
  onlyDomainIds: ['fd-06-ionos-174'],
  extras: {
    ownGroupId: DLE_LAB_GROUP_ID,
    planeDirectory: mergePlaneDirectories(
      planeDirectoryFromHosts(DLE_LAB_GROUP_ID, g1Hosts, g1Inventory),
      planeDirectoryFromHosts(DLE_LAB_M6_GROUP_ID, g2Hosts, g2Inventory),
    ),
  },
})
console.log(JSON.stringify(result, null, 2))
process.exit(result.ok ? 0 : 2)
