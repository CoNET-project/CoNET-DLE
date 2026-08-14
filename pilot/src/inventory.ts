import type {
  OperatorDomainPreflightReport,
  OperatorDomainV1,
  PilotInventoryV1,
  PreflightCheck,
} from './model.js'

const REQUIRED_DOMAIN_COUNT = 7
const REQUIRED_ACTIVE_COUNT = 5
const REQUIRED_STANDBY_COUNT = 2

function checkUnique(
  domains: OperatorDomainV1[],
  field: keyof Pick<OperatorDomainV1, 'domainId' | 'operatorDomainId' | 'hostId'>,
): PreflightCheck {
  const values = domains.map((domain) => domain[field].trim().toLowerCase())
  const unique = new Set(values)
  return {
    check: `unique-${field}`,
    ok: unique.size === values.length && !values.includes(''),
    detail: `${unique.size}/${values.length} unique non-empty values`,
  }
}

export function preflightOperatorDomains(inventory: PilotInventoryV1): OperatorDomainPreflightReport {
  const activeCount = inventory.domains.filter((domain) => domain.role === 'active').length
  const standbyCount = inventory.domains.filter((domain) => domain.role === 'standby').length
  const requiredFieldsPresent = inventory.domains.every((domain) =>
    [
      domain.domainId,
      domain.operatorDomainId,
      domain.operatorLegalName,
      domain.hostId,
      domain.provider,
      domain.region,
      domain.networkAsn,
      domain.billingRef,
    ].every((value) => value.trim().length > 0),
  )
  const noUnsafePlaceholders = inventory.domains.every((domain) =>
    [domain.hostId, domain.billingRef].every(
      (value) => !/[<>]/u.test(value) && !/\b(?:todo|tbd|replace[-_ ]?me)\b/iu.test(value),
    ),
  )
  const checks: PreflightCheck[] = [
    {
      check: 'schema',
      ok: inventory.schema === 'PilotInventoryV1',
      detail: `received ${inventory.schema}`,
    },
    {
      check: 'seven-failure-domains',
      ok: inventory.domains.length === REQUIRED_DOMAIN_COUNT,
      detail: `received ${inventory.domains.length}, require ${REQUIRED_DOMAIN_COUNT}`,
    },
    {
      check: 'five-active-two-standby',
      ok: activeCount === REQUIRED_ACTIVE_COUNT && standbyCount === REQUIRED_STANDBY_COUNT,
      detail: `active=${activeCount}, standby=${standbyCount}`,
    },
    checkUnique(inventory.domains, 'domainId'),
    checkUnique(inventory.domains, 'operatorDomainId'),
    checkUnique(inventory.domains, 'hostId'),
    {
      check: 'required-fields',
      ok: requiredFieldsPresent,
      detail: requiredFieldsPresent ? 'all fields present' : 'one or more fields are blank',
    },
    {
      check: 'real-host-and-billing-inputs',
      ok: noUnsafePlaceholders,
      detail: noUnsafePlaceholders ? 'no placeholder markers found' : 'placeholder input found',
    },
  ]
  return {
    ok: checks.every((check) => check.ok),
    activeCount,
    standbyCount,
    checks,
  }
}

export function assertOperatorDomainPreflight(inventory: PilotInventoryV1): void {
  const report = preflightOperatorDomains(inventory)
  if (!report.ok) {
    const failed = report.checks
      .filter((check) => !check.ok)
      .map((check) => `${check.check}: ${check.detail}`)
      .join('; ')
    throw new Error(`OperatorDomain preflight failed: ${failed}`)
  }
}
