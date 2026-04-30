// =============================================================
// Clients list + inline create form (Screen 1, S13).
//
// Client onboarding entry point: legal entity name, UEN with
// country-pattern validation, address, industry (SSIC), primary
// contact. Country & Industry feed from the global reference
// router (system-level seed data).
// =============================================================

'use client';

import { ScreenShell } from '@/components/ui';
import { trpc } from '@/lib/trpc/client';
import Link from 'next/link';
import { useMemo, useState } from 'react';

type FormState = {
  legalName: string;
  tradingName: string;
  uen: string;
  countryOfIncorporation: string;
  address: string;
  industry: string;
  primaryContactName: string;
  primaryContactEmail: string;
};

const emptyForm: FormState = {
  legalName: '',
  tradingName: '',
  uen: '',
  countryOfIncorporation: 'SG',
  address: '',
  industry: '',
  primaryContactName: '',
  primaryContactEmail: '',
};

export function ClientsScreen() {
  const utils = trpc.useUtils();
  const list = trpc.clients.list.useQuery();
  const countries = trpc.referenceData.countries.useQuery();
  const industries = trpc.referenceData.industries.useQuery();

  const create = trpc.clients.create.useMutation({
    onSuccess: async () => {
      setForm(emptyForm);
      setFormError(null);
      await utils.clients.list.invalidate();
    },
    onError: (err) => setFormError(err.message),
  });
  const remove = trpc.clients.delete.useMutation({
    onSuccess: () => utils.clients.list.invalidate(),
    onError: (err) => setFormError(err.message),
  });

  const [form, setForm] = useState<FormState>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);

  const selectedCountry = useMemo(
    () => countries.data?.find((c) => c.code === form.countryOfIncorporation) ?? null,
    [countries.data, form.countryOfIncorporation],
  );

  // Client-side UEN match preview. Server validates again on save.
  const uenLooksValid = useMemo(() => {
    if (!form.uen) return null;
    if (!selectedCountry?.uenPattern) return null;
    try {
      return new RegExp(selectedCountry.uenPattern).test(form.uen);
    } catch {
      return null;
    }
  }, [form.uen, selectedCountry?.uenPattern]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    create.mutate({
      legalName: form.legalName.trim(),
      tradingName: form.tradingName.trim() || null,
      uen: form.uen.trim(),
      countryOfIncorporation: form.countryOfIncorporation,
      address: form.address.trim(),
      industry: form.industry || null,
      primaryContactName: form.primaryContactName.trim() || null,
      primaryContactEmail: form.primaryContactEmail.trim() || null,
      status: 'ACTIVE',
    });
  };

  // Country lookup map for the list table.
  const countryName = (code: string) => countries.data?.find((c) => c.code === code)?.name ?? code;

  return (
    <ScreenShell title="Clients">
      <section className="section">
        <div className="card card-padded">
          <h3 className="mb-4">New client</h3>
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
                placeholder="Balance Medical Pte. Ltd."
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
                placeholder="Balance Medical"
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
                placeholder={
                  selectedCountry?.uenPattern ? '202012345A' : 'Business registration number'
                }
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
                placeholder="1 North Bridge Road, #08-08, High Street Centre, Singapore 179094"
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
                placeholder="Jane Tan"
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
                placeholder="hr@balancemedical.sg"
              />
            </div>

            {formError ? <p className="field-error">{formError}</p> : null}

            <div className="row">
              <button
                type="submit"
                className="btn btn-primary"
                disabled={create.isPending || uenLooksValid === false}
              >
                {create.isPending ? 'Saving…' : 'Add client'}
              </button>
            </div>
          </form>
        </div>
      </section>

      <section className="section">
        <h3 className="mb-3">Existing clients</h3>
        {list.isLoading ? (
          <p>Loading…</p>
        ) : list.error ? (
          <p className="field-error">Failed to load: {list.error.message}</p>
        ) : list.data && list.data.length > 0 ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Legal name</th>
                  <th>Trading name</th>
                  <th>UEN</th>
                  <th>Country</th>
                  <th>Status</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {list.data.map((client) => (
                  <tr key={client.id}>
                    <td>{client.legalName}</td>
                    <td>{client.tradingName ?? '—'}</td>
                    <td>
                      <code>{client.uen}</code>
                    </td>
                    <td>{countryName(client.countryOfIncorporation)}</td>
                    <td>
                      <span
                        className={
                          client.status === 'ACTIVE'
                            ? 'pill pill-success'
                            : client.status === 'DRAFT'
                              ? 'pill pill-muted'
                              : 'pill pill-muted'
                        }
                      >
                        {client.status}
                      </span>
                    </td>
                    <td>
                      <div className="row-end">
                        <Link
                          href={`/admin/clients/${client.id}/policies`}
                          className="btn btn-ghost btn-sm"
                        >
                          Policies
                        </Link>
                        <Link
                          href={`/admin/clients/${client.id}/imports`}
                          className="btn btn-ghost btn-sm"
                        >
                          Imports
                        </Link>
                        <Link
                          href={`/admin/clients/${client.id}/employees`}
                          className="btn btn-ghost btn-sm"
                        >
                          Employees
                        </Link>
                        <Link
                          href={`/admin/clients/${client.id}/claims`}
                          className="btn btn-ghost btn-sm"
                        >
                          Claims
                        </Link>
                        <Link
                          href={`/admin/clients/${client.id}/edit`}
                          className="btn btn-ghost btn-sm"
                        >
                          Edit
                        </Link>
                        <button
                          type="button"
                          className="btn btn-danger btn-sm"
                          onClick={() => {
                            if (
                              window.confirm(`Delete ${client.legalName}? This cannot be undone.`)
                            ) {
                              remove.mutate({ id: client.id });
                            }
                          }}
                          disabled={remove.isPending}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="card card-padded text-center">
            <p className="mb-0">No clients yet. Add your first one above.</p>
          </div>
        )}
      </section>
    </ScreenShell>
  );
}
