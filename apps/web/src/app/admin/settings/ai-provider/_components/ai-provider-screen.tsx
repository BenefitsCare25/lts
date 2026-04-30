// =============================================================
// AiProviderScreen — Azure AI Foundry credential UI.
//
// Shows the current configuration (endpoint, deployment, last 4
// chars of key) when set, and an upsert form. The plaintext key
// is only sent in the upsert mutation; subsequent reads return
// the masked summary only.
//
// Save: encrypts and stores. Test: hits Azure AI Foundry with the
// stored key. Clear: deletes the row.
// =============================================================

'use client';

import { Card, ConfidenceBadge, Field, ScreenShell } from '@/components/ui';
import { trpc } from '@/lib/trpc/client';
import { useEffect, useState } from 'react';

const DEFAULT_API_VERSION = '2024-08-01-preview';

interface FormState {
  endpoint: string;
  deploymentName: string;
  apiVersion: string;
  apiKey: string;
}

const emptyForm: FormState = {
  endpoint: '',
  deploymentName: '',
  apiVersion: DEFAULT_API_VERSION,
  apiKey: '',
};

interface TestResult {
  ok: boolean;
  detail: string;
  latencyMs?: number;
  status?: number;
}

export function AiProviderScreen() {
  const utils = trpc.useUtils();
  const masked = trpc.tenantAiProvider.getMasked.useQuery();

  const upsert = trpc.tenantAiProvider.upsert.useMutation({
    onSuccess: async () => {
      setForm((prev) => ({ ...prev, apiKey: '' }));
      setFormError(null);
      setTestResult(null);
      await utils.tenantAiProvider.getMasked.invalidate();
    },
    onError: (err) => setFormError(err.message),
  });

  const clear = trpc.tenantAiProvider.clear.useMutation({
    onSuccess: async () => {
      setForm(emptyForm);
      setFormError(null);
      setTestResult(null);
      await utils.tenantAiProvider.getMasked.invalidate();
    },
    onError: (err) => setFormError(err.message),
  });

  const test = trpc.tenantAiProvider.test.useMutation({
    onSuccess: (result) => {
      if (result.ok) {
        setTestResult({
          ok: true,
          detail: `Reached endpoint in ${result.latencyMs} ms`,
          latencyMs: result.latencyMs,
        });
      } else {
        setTestResult({
          ok: false,
          detail: result.error,
          status: result.status,
        });
      }
    },
    onError: (err) => setTestResult({ ok: false, detail: err.message }),
  });

  const [form, setForm] = useState<FormState>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  // When a configuration is loaded, pre-fill the non-secret fields
  // so the broker can edit one value (say, the deployment name)
  // without having to re-paste the key. The apiKey input stays
  // empty — the existing key is preserved unless the broker types
  // a new value (the upsert mutation requires apiKey, so we block
  // submit until they re-enter it; see `keyRequired`).
  useEffect(() => {
    if (masked.data?.configured) {
      setForm({
        endpoint: masked.data.endpoint ?? '',
        deploymentName: masked.data.deploymentName ?? '',
        apiVersion: masked.data.apiVersion ?? DEFAULT_API_VERSION,
        apiKey: '',
      });
    }
  }, [masked.data]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    upsert.mutate({
      endpoint: form.endpoint.trim(),
      deploymentName: form.deploymentName.trim(),
      apiVersion: form.apiVersion.trim(),
      apiKey: form.apiKey,
    });
  };

  const isSaving = upsert.isPending;
  const isClearing = clear.isPending;
  const isTesting = test.isPending;

  const updatedAtLabel = masked.data?.updatedAt
    ? new Date(masked.data.updatedAt).toLocaleString('en-SG', {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : null;

  return (
    <ScreenShell title="AI Provider">
      {masked.isLoading ? (
        <p>Loading…</p>
      ) : masked.error ? (
        <p className="field-error">Failed to load: {masked.error.message}</p>
      ) : (
        <>
          {masked.data?.configured ? (
            <section className="section">
              <Card variant="padded">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <h3 className="mb-0">Current configuration</h3>
                  <ConfidenceBadge confidence={masked.data.active ? 1 : 0.5} variant="pill" />
                </div>
                <dl className="dl">
                  <dt>Provider</dt>
                  <dd>Azure AI Foundry</dd>
                  <dt>Endpoint</dt>
                  <dd>{masked.data.endpoint}</dd>
                  <dt>Deployment</dt>
                  <dd>{masked.data.deploymentName}</dd>
                  <dt>API version</dt>
                  <dd>{masked.data.apiVersion}</dd>
                  <dt>API key</dt>
                  <dd>•••• •••• •••• {masked.data.keyLastFour}</dd>
                  <dt>Last updated</dt>
                  <dd>{updatedAtLabel}</dd>
                </dl>
                <div className="row mt-4">
                  <button
                    type="button"
                    className="btn"
                    onClick={() => test.mutate()}
                    disabled={isTesting}
                  >
                    {isTesting ? 'Testing…' : 'Test connection'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger"
                    onClick={() => {
                      if (
                        window.confirm(
                          'Remove the AI provider configuration? Extraction will fail until a new key is saved.',
                        )
                      ) {
                        clear.mutate();
                      }
                    }}
                    disabled={isClearing}
                  >
                    {isClearing ? 'Removing…' : 'Clear configuration'}
                  </button>
                </div>
                {testResult ? (
                  <output className={testResult.ok ? 'field-help mt-3' : 'field-error mt-3'}>
                    {testResult.ok ? '✓ ' : '✗ '}
                    {testResult.detail}
                    {testResult.status ? ` (HTTP ${testResult.status})` : ''}
                  </output>
                ) : null}
              </Card>
            </section>
          ) : null}

          <section className="section">
            <Card variant="padded">
              <h3 className="mb-3">
                {masked.data?.configured ? 'Update credentials' : 'Add credentials'}
              </h3>
              <form onSubmit={submit} className="form-grid">
                <Field
                  label="Endpoint"
                  htmlFor="aip-endpoint"
                  hint="The resource URL from Azure AI Foundry, e.g. https://my-resource.services.ai.azure.com"
                  required
                >
                  <input
                    id="aip-endpoint"
                    className="input"
                    type="url"
                    required
                    placeholder="https://my-resource.services.ai.azure.com"
                    value={form.endpoint}
                    onChange={(e) => setForm({ ...form, endpoint: e.target.value })}
                  />
                </Field>

                <Field
                  label="Deployment name"
                  htmlFor="aip-deployment"
                  hint="The deployed model name in your Foundry resource (Settings → Deployments)."
                  required
                >
                  <input
                    id="aip-deployment"
                    className="input"
                    type="text"
                    required
                    placeholder="claude-sonnet-4 / gpt-4o-mini / …"
                    value={form.deploymentName}
                    onChange={(e) => setForm({ ...form, deploymentName: e.target.value })}
                  />
                </Field>

                <Field
                  label="API version"
                  htmlFor="aip-apiversion"
                  hint="Azure REST API version. Leave the default unless the Foundry portal lists a newer one."
                >
                  <input
                    id="aip-apiversion"
                    className="input"
                    type="text"
                    value={form.apiVersion}
                    onChange={(e) => setForm({ ...form, apiVersion: e.target.value })}
                  />
                </Field>

                <Field
                  label="API key"
                  htmlFor="aip-apikey"
                  hint={
                    masked.data?.configured
                      ? `Re-enter the key to update or rotate it. The currently saved key ends in ${masked.data.keyLastFour}.`
                      : 'Found in Azure portal → AI Foundry resource → Keys and Endpoint.'
                  }
                  required
                >
                  <input
                    id="aip-apikey"
                    className="input"
                    type="password"
                    required
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="Paste the API key"
                    value={form.apiKey}
                    onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                  />
                </Field>

                {formError ? <p className="field-error">{formError}</p> : null}

                <div className="row">
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={isSaving || form.apiKey.length === 0}
                  >
                    {isSaving ? 'Saving…' : masked.data?.configured ? 'Update' : 'Save'}
                  </button>
                </div>
              </form>
            </Card>
          </section>
        </>
      )}
    </ScreenShell>
  );
}
