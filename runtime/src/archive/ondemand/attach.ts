import type { Hex } from '../../shared/bytes.js'
import type { SelectionLog } from '../../shared/ondemand/index.js'
import type { DepositBundle } from '../bft/types.js'

/** Optional SelectionLog fields. Mode A hashes only event / parent / l1EscrowView. */
export function attachSelectionToDepositBundle(
  bundle: DepositBundle,
  selection: SelectionLog,
): DepositBundle {
  return {
    ...bundle,
    selectionLogRef: selection.poolRoot,
    committee: [...selection.committee] as Hex[],
    standbys: [...selection.standbys] as Hex[],
  }
}
