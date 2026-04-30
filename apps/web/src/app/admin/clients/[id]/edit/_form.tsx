// =============================================================
// Client edit form — same field set as the create form on the
// list page, separated only because we need the client's id and
// initial data to populate the controls.
// =============================================================

'use client';

import { ScreenShell } from '@/components/ui';
import { trpc } from '@/lib/trpc/client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

// Mirrors prisma's ClientStatus enum so we don't pull Prisma into
// the client bundle. Server-side validation re-checks via Zod.
type ClientStatus = 'ACTIVE' | 'DRAFT' | 'ARCHIVED';

type FormState = {
  legalName: string;
  tradingName: string;
  uen: string;
  countryOfIncorporation: string;
  address: string;
  industry: string;
  primaryContactName: string;
  primaryContactEmail: string;
  status: ClientStatus;
};

export function EditClientForm({ clientId }: { clientId: string }) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const client = trpc.clients.byId.useQuery({ id: clientId });
  const countries = trpc.referenceData.countries.useQuery();
  const industries = trpc.referenceData.industries.useQuery();

  const update = trpc.clients.update.useMutation({
    onSuccess: async () => {
      await utils.clients.list.invalidate();
      await utils.clients.byId.invalidate({ id: clientId });
      router.push('/admin/clients');
    },
    onError: (err) => setFormError(err.message),
  });

  const [form, setForm] = useState<FormState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!client.data || form !== null) return;
    setForm({
      legalName: client.data.legalName,
      tradingName: client.data.tradingName ?? '',
      uen: client.data.uen,
      countryOfIncorporation: client.data.countryOfIncorporation,
      address: client.data.address,
      industry: client.data.industry ?? '',
      primaryContactName: client.data.primaryContactName ?? '',
      primaryContactEmail: client.data.primaryContactEmail ?? '',
      status: client.data.status,
    });
  }, [client.data, form]);

  const selectedCountry = useMemo(
    () =>
      form === null
        ? null
        : (countries.data?.find((c) => c.code === form.countryOfIncorporation) ?? null),
    [countries.data, form],
  );

  const uenLooksValid = useMemo(() => {
    if (!form?.uen) return null;
    if (!selectedCountry?.uenPattern) return null;
    try {
      return new RegExp(selectedCountry.uenPattern).test(form.uen);
    } catch {
      return null;
    }
  }, [form?.uen, selectedCountry?.uenPattern]);

  if (client.isLoading || form === null) return <p>Loading…</p>;
  if (client.error) return <p className="field-error">Failed to load: {client.error.message}</p>;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    update.mutate({
      id: clientId,
      data: {
        legalName: form.legalName.trim(),
        tradingName: form.tradingName.trim() || null,
        uen: form.uen.trim(),
        countryOfIncorporation: form.countryOfIncorporation,
        address: form.address.trim(),
        industry: form.industry || null,
        primaryContactName: form.primaryContactName.trim() || null,
        primaryContactEmail: form.primaryContactEmail.trim() || null,
        status: form.status,
      },
    });
  };

  return (
    <ScreenShell title="Edit client">
      <section className="section">
        <div className="card card-padded">
          <form onSubmit={submit} className="form-grid">
            <div className="field">
              <label className="field-label" htmlFor="cli-legal">
                Legal entity name
              </label>
              <input
                id="cli-legal"
                className="input"
                type="text"
                required
                maxLength={200}
                value={form.legalName}
                onChange={(e) => setForm({ ...form, legalName: e.target.value })}
              />
            </div>

            <div className="field">
              <label className="field-label" htmlFor="cli-trading">
                Trading name <span className="field-help-inline">(optional)</span>
              </label>
              <input
                id="cli-trading"
                className="input"
                type="text"
                maxLength={200}
                value={form.tradingName}
                onChange={(e) => setForm({ ...form, tradingName: e.target.value })}
              />
            </div>

            <div className="field">
              <label className="field-label" htmlFor="cli-country">
                Country of incorporation
              </label>
              <select
                id="cli-country"
                className="input"
                required
                value={form.countryOfIncorporation}
                onChange={(e) => setForm({ ...form, countryOfIncorporation: e.target.value })}
                disabled={countries.isLoading}
              >
                {countries.data?.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name} ({c.code})
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label className="field-label" htmlFor="cli-uen">
                UEN
              </label>
              <input
                id="cli-uen"
                className="input"
                type="text"
                required
                maxLength={40}
                value={form.uen}
                onChange={(e) => setForm({ ...form, uen: e.target.value.toUpperCase() })}
                pattern={selectedCountry?.uenPattern ?? undefined}
              />
              <span className="field-help">
                {selectedCountry?.uenPattern
                  ? `Format for ${selectedCountry.name}: ${selectedCountry.uenPattern}`
                  : `No registration format on file for ${selectedCountry?.name ?? 'this country'} — any value accepted.`}
                {uenLooksValid === false ? (
                  <>
                    {' '}
                    <strong className="text-error">Does not match expected format.</strong>
                  </>
                ) : null}
              </span>
            </div>

            <div className="field">
              <label className="field-label" htmlFor="cli-address">
                Registered address
              </label>
              <textarea
                id="cli-address"
                className="input"
                required
                maxLength={500}
                rows={2}
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
              />
            </div>

            <div className="field">
              <label className="field-label" htmlFor="cli-industry">
                Industry (SSIC) <span className="field-help-inline">(optional)</span>
              </label>
              <select
                id="cli-industry"
                className="input"
                value={form.industry}
                onChange={(e) => setForm({ ...form, industry: e.target.value })}
                disabled={industries.isLoading}
              >
                <option value="">— Select industry —</option>
                {industries.data?.map((i) => (
                  <option key={i.code} value={i.code}>
                    {i.code} · {i.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label className="field-label" htmlFor="cli-contact-name">
                Primary contact name <span className="field-help-inline">(optional)</span>
              </label>
              <input
                id="cli-contact-name"
                className="input"
                type="text"
                maxLength={120}
                value={form.primaryContactName}
                onChange={(e) => setForm({ ...form, primaryContactName: e.target.value })}
              />
            </div>

            <div className="field">
              <label className="field-label" htmlFor="cli-contact-email">
                Contact email <span className="field-help-inline">(optional)</span>
              </label>
              <input
                id="cli-contact-email"
                className="input"
                type="email"
                maxLength={254}
                value={form.primaryContactEmail}
                onChange={(e) => setForm({ ...form, primaryContactEmail: e.target.value })}
              />
            </div>

            <div className="field">
              <label className="field-label" htmlFor="cli-status">
                Status
              </label>
              <select
                id="cli-status"
                className="input"
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value as ClientStatus })}
              >
                <option value="ACTIVE">Active</option>
                <option value="DRAFT">Draft</option>
                <option value="ARCHIVED">Archived</option>
              </select>
            </div>

            {formError ? <p className="field-error">{formError}</p> : null}

            <div className="row">
              <button
                type="submit"
                className="btn btn-primary"
                disabled={update.isPending || uenLooksValid === false}
              >
                {update.isPending ? 'Saving…' : 'Save changes'}
              </button>
              <Link href="/admin/clients" className="btn btn-ghost">
                Cancel
              </Link>
            </div>
          </form>
        </div>
      </section>
    </ScreenShell>
  );
}
