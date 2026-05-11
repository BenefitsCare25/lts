'use client';

import { Card, ScreenShell } from '@/components/ui';
import { formatDate } from '@/lib/format-date';
import { trpc } from '@/lib/trpc/client';
import { useState } from 'react';
import { ClassOverridesTab } from './class-overrides-tab';
import { DataUploadTab } from './data-upload-tab';
import { ErrorQueueTab } from './error-queue-tab';
import { FlexWalletTab } from './flex-wallet-tab';
import { GradeMapTab } from './grade-map-tab';
import { NationalityOverridesTab } from './nationality-overrides-tab';
import { PlanRulesTab } from './plan-rules-tab';
import { SalaryBandsTab } from './salary-bands-tab';

const TABS = [
  { key: 'grade-map', label: 'Grade Map' },
  { key: 'salary-bands', label: 'Salary Bands' },
  { key: 'plan-rules', label: 'Plan Assignment' },
  { key: 'class-overrides', label: 'Employment Class' },
  { key: 'nationality', label: 'Nationality' },
  { key: 'flex-wallet', label: 'Flex Wallet' },
  { key: 'upload', label: 'Data Upload' },
  { key: 'errors', label: 'Error Queue' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

export function RulesScreen({ clientId }: { clientId: string }) {
  const [activeTab, setActiveTab] = useState<TabKey>('grade-map');
  const [selectedBenefitYearId, setSelectedBenefitYearId] = useState<string>('');

  const benefitYears = trpc.benefitYears.listByClient.useQuery({ clientId });
  const process = trpc.ruleTables.engine.processBenefitYear.useMutation();
  const dryRun = trpc.ruleTables.engine.dryRun.useMutation();

  const benefitYearList = benefitYears.data ?? [];
  const activeBenefitYearId = selectedBenefitYearId || benefitYearList[0]?.id || '';
  const selectedYear = benefitYearList.find((by) => by.id === activeBenefitYearId);

  const handleProcess = () => {
    if (!activeBenefitYearId) return;
    dryRun.reset();
    process.mutate({ benefitYearId: activeBenefitYearId, clientId });
  };

  const handleDryRun = () => {
    if (!activeBenefitYearId) return;
    process.reset();
    dryRun.mutate({ benefitYearId: activeBenefitYearId, clientId });
  };

  const result = process.data ?? dryRun.data;
  const mutationError = process.error ?? dryRun.error;

  return (
    <ScreenShell
      title="Rules"
      context={
        selectedYear
          ? `${selectedYear.policy.name} — ${formatDate(selectedYear.startDate)}`
          : undefined
      }
      actions={
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            onClick={handleDryRun}
            disabled={!activeBenefitYearId || dryRun.isPending}
          >
            {dryRun.isPending ? 'Running...' : 'Dry Run'}
          </button>
          <button
            type="button"
            className="btn btn--primary btn--sm"
            onClick={handleProcess}
            disabled={!activeBenefitYearId || process.isPending}
          >
            {process.isPending ? 'Processing...' : 'Process'}
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <Card>
          <div className="flex items-center gap-3">
            <label
              htmlFor="benefit-year-select"
              className="text-sm font-medium text-muted-foreground"
            >
              Benefit Year
            </label>
            <select
              id="benefit-year-select"
              className="field__input"
              value={activeBenefitYearId}
              onChange={(e) => setSelectedBenefitYearId(e.target.value)}
            >
              {benefitYearList.length === 0 && <option value="">No benefit years</option>}
              {benefitYearList.map((by) => (
                <option key={by.id} value={by.id}>
                  {by.policy.name} — {formatDate(by.startDate)} ({by.state})
                </option>
              ))}
            </select>
          </div>
        </Card>

        {result && (
          <Card>
            <div className="flex items-center gap-4 text-sm">
              <span>Total: {result.total}</span>
              <span className="text-emerald-600">Resolved: {result.resolved}</span>
              <span className="text-red-600">Errors: {result.errors}</span>
              <span>Created: {result.created}</span>
              <span>Updated: {result.updated}</span>
            </div>
            {result.engineBreakdown && (
              <div className="mt-2 flex gap-6 text-xs text-muted-foreground">
                <div>
                  <span className="font-medium">Insurance:</span>{' '}
                  {result.engineBreakdown.insurance.resolved} resolved,{' '}
                  {result.engineBreakdown.insurance.errors} errors
                </div>
                <div>
                  <span className="font-medium">Flex Wallet:</span>{' '}
                  {result.engineBreakdown.flex.resolved} resolved,{' '}
                  {result.engineBreakdown.flex.errors} errors
                </div>
              </div>
            )}
          </Card>
        )}

        {mutationError && (
          <Card>
            <p className="text-sm text-red-600">{mutationError.message}</p>
          </Card>
        )}

        <nav className="flex gap-1 border-b border-border" aria-label="Rule tables">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={`px-3 py-2 text-sm transition-colors ${
                activeTab === tab.key
                  ? 'border-b-2 border-foreground text-foreground font-medium'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        {activeBenefitYearId && (
          <div>
            {activeTab === 'grade-map' && <GradeMapTab benefitYearId={activeBenefitYearId} />}
            {activeTab === 'salary-bands' && <SalaryBandsTab benefitYearId={activeBenefitYearId} />}
            {activeTab === 'plan-rules' && <PlanRulesTab benefitYearId={activeBenefitYearId} />}
            {activeTab === 'class-overrides' && (
              <ClassOverridesTab benefitYearId={activeBenefitYearId} />
            )}
            {activeTab === 'nationality' && (
              <NationalityOverridesTab benefitYearId={activeBenefitYearId} />
            )}
            {activeTab === 'flex-wallet' && <FlexWalletTab benefitYearId={activeBenefitYearId} />}
            {activeTab === 'upload' && <DataUploadTab clientId={clientId} />}
            {activeTab === 'errors' && <ErrorQueueTab benefitYearId={activeBenefitYearId} />}
          </div>
        )}
      </div>
    </ScreenShell>
  );
}
