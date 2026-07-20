import type { HostAuthMethod, TerminalHost } from '@/ipc/terminalHosts'

/** Form field values (port as string for controlled input). */
export interface HostFormValues {
  label: string
  hostname: string
  port: string
  username: string
  authMethod: HostAuthMethod
  /** Write-only; empty means keep existing on edit. */
  password: string
  privateKeyPath: string
  /** Write-only optional; empty means keep existing on edit. */
  passphrase: string
  /** Empty string = ungrouped. */
  groupId: string
  remotePath: string
}

export type HostFormField =
  | 'label'
  | 'hostname'
  | 'port'
  | 'username'
  | 'password'
  | 'privateKeyPath'

export type HostFormErrors = Partial<Record<HostFormField, string>>

export function emptyHostFormValues(): HostFormValues {
  return {
    label: '',
    hostname: '',
    port: '22',
    username: '',
    authMethod: 'password',
    password: '',
    privateKeyPath: '',
    passphrase: '',
    groupId: '',
    remotePath: '',
  }
}

export function hostToFormValues(host: TerminalHost): HostFormValues {
  return {
    label: host.label,
    hostname: host.hostname,
    port: String(host.port),
    username: host.username,
    authMethod: host.authMethod,
    password: '',
    privateKeyPath: host.privateKeyPath ?? '',
    passphrase: '',
    groupId: host.groupId ?? '',
    remotePath: host.remotePath ?? '',
  }
}

export interface ValidateHostFormOpts {
  mode: 'create' | 'edit'
  /** True when `hip.ssh.<id>.password` is present (edit). */
  passwordSaved: boolean
  /** True when passphrase secret is present (edit). Not required for validity. */
  passphraseSaved?: boolean
}

/**
 * Field-level validation. Error values are i18n keys under `terminals.form.*`.
 */
export function validateHostForm(
  values: HostFormValues,
  opts: ValidateHostFormOpts,
): HostFormErrors {
  const errors: HostFormErrors = {}

  if (!values.label.trim()) {
    errors.label = 'terminals.form.labelRequired'
  }
  if (!values.hostname.trim()) {
    errors.hostname = 'terminals.form.hostnameRequired'
  }
  if (!values.username.trim()) {
    errors.username = 'terminals.form.usernameRequired'
  }

  const port = Number(values.port)
  if (
    !values.port.trim() ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  ) {
    errors.port = 'terminals.form.portInvalid'
  }

  if (values.authMethod === 'password') {
    const hasPassword =
      values.password.length > 0 || (opts.mode === 'edit' && opts.passwordSaved)
    if (!hasPassword) {
      errors.password = 'terminals.form.passwordRequired'
    }
  } else if (!values.privateKeyPath.trim()) {
    errors.privateKeyPath = 'terminals.form.privateKeyPathRequired'
  }

  return errors
}

export function isHostFormValid(
  values: HostFormValues,
  opts: ValidateHostFormOpts,
): boolean {
  return Object.keys(validateHostForm(values, opts)).length === 0
}

/** Build a TerminalHost from form values (does not touch secrets). */
export function formValuesToHost(
  values: HostFormValues,
  id: string,
  updatedAt: number,
): TerminalHost {
  const port = Number(values.port)
  const host: TerminalHost = {
    id,
    label: values.label.trim(),
    hostname: values.hostname.trim(),
    port: Number.isInteger(port) ? port : 22,
    username: values.username.trim(),
    authMethod: values.authMethod,
    updatedAt,
  }
  if (values.groupId.trim()) {
    host.groupId = values.groupId.trim()
  }
  if (values.authMethod === 'privateKey' && values.privateKeyPath.trim()) {
    host.privateKeyPath = values.privateKeyPath.trim()
  }
  if (values.remotePath.trim()) {
    host.remotePath = values.remotePath.trim()
  }
  return host
}

export function mintHostId(nanoid: () => string): string {
  return `hst_${nanoid()}`
}

export function mintGroupId(nanoid: () => string): string {
  return `grp_${nanoid()}`
}
