import { Wallet } from 'lucide-react'
import { AddressCapsule } from './AddressCapsule'

export function ParticipantWallet({ address }: { address: string }) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return (
      <div className="inline-flex items-center gap-2 rounded-full border border-[#dce2f7] bg-[#e9edff] px-3 py-1.5 text-[11px] font-semibold text-[#424655]">
        <Wallet className="h-3.5 w-3.5 text-[#0051d1]" strokeWidth={2.25} aria-hidden />
        Participant wallet unavailable
      </div>
    )
  }

  return (
    <AddressCapsule
      address={address}
      className="max-w-full border-[#dce2f7] bg-[#e9edff] text-[#424655]"
      leadingIcon={<Wallet className="h-3.5 w-3.5 text-[#0051d1]" strokeWidth={2.25} aria-hidden />}
    />
  )
}
