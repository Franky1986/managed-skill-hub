import { useEffect, useState } from 'react';
import { proposalsApi, type HowToProposeResponse } from '../api/proposals';
import { handleApiError } from '../api/client';
import { useLanguage } from '../i18n';

export function HowToProposePage() {
    const [guide, setGuide] = useState<HowToProposeResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const { language, t } = useLanguage();

    useEffect(() => {
        setLoading(true);
        proposalsApi
            .howToPropose()
            .then((response) => setGuide(response.data))
            .catch((err) => setError(handleApiError(err, language)))
            .finally(() => setLoading(false));
    }, [language]);

    if (loading) {
        return <div className="py-xl text-center text-on-surface-variant">{t('howTo.loading')}</div>;
    }

    if (error) {
        return (
            <div className="bg-error-container text-on-error-container rounded-xl p-lg border border-error/20">
                {t('howTo.error', { message: error })}
            </div>
        );
    }

    if (!guide) {
        return <div className="py-xl text-center text-on-surface-variant">{t('howTo.empty')}</div>;
    }

    return (
        <div className="space-y-xl">
            <section className="bg-surface-container-low rounded-2xl p-xl border border-outline-variant shadow-ambient">
                <div className="space-y-md">
                    <div className="inline-flex rounded-full border border-outline-variant bg-surface px-3 py-1 font-mono text-mono text-on-surface-variant">
                        {t('howTo.kicker')}
                    </div>
                    <h1 className="font-h1 text-h1 text-on-background">{guide.title}</h1>
                    <p className="font-body text-body text-on-surface-variant max-w-3xl">{guide.description}</p>
                    <div className="rounded-xl border border-outline-variant bg-surface px-lg py-md text-sm text-on-surface">
                        {t('howTo.humanUi')}: <span className="font-mono">/frontend</span><br />
                        {t('howTo.agentStart')}: <span className="font-mono">/api/discover</span><br />
                        {t('howTo.requiredBeforeUpload')}: <span className="font-mono">/api/howToPropose</span>
                    </div>
                </div>
            </section>


            <section className="rounded-2xl border border-outline-variant bg-surface-container-lowest p-lg shadow-ambient">
                <div className="flex flex-col gap-md lg:flex-row lg:items-center lg:justify-between">
                    <div className="space-y-sm">
                        <h2 className="font-h3 text-h3 text-on-background">{t('howTo.auth.title')}</h2>
                        <p className="font-body text-body text-on-surface-variant">{t('howTo.auth.copy')}</p>
                        <div className="grid gap-sm text-sm text-on-surface sm:grid-cols-2 lg:grid-cols-4">
                            <div className="rounded-lg border border-outline-variant bg-surface px-md py-sm">
                                {t('howTo.auth.registry')}: <span className="font-mono text-mono">{guide.apiNotes?.registryId ?? 'local'}</span>
                            </div>
                            <div className="rounded-lg border border-outline-variant bg-surface px-md py-sm">
                                {t('howTo.auth.read')}: {guide.apiNotes?.readAuthRequired ? t('common.yes') : t('common.no')}
                            </div>
                            <div className="rounded-lg border border-outline-variant bg-surface px-md py-sm">
                                {t('howTo.auth.proposal')}: {guide.apiNotes?.proposalAuthRequired ? t('common.yes') : t('common.no')}
                            </div>
                            <div className="rounded-lg border border-outline-variant bg-surface px-md py-sm">
                                {t('howTo.auth.tokenChat')}: <strong>{t('howTo.auth.never')}</strong>
                            </div>
                        </div>
                    </div>

                </div>
                {guide.apiNotes?.authSetupFlow && (
                    <p className="mt-md rounded-xl border border-outline-variant bg-surface px-lg py-md text-sm text-on-surface-variant">
                        {guide.apiNotes.authSetupFlow}
                    </p>
                )}
            </section>

            <section className="grid gap-lg">
                {guide.requiredSteps.map((step) => (
                    <article key={step.step} className="rounded-2xl border border-outline-variant bg-surface-container-lowest p-lg shadow-ambient">
                        <div className="flex items-start gap-md">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-container text-on-primary-container font-semibold">
                                {step.step}
                            </div>
                            <div className="space-y-sm">
                                <h2 className="font-h3 text-h3 text-on-background">{step.title}</h2>
                                <p className="font-body text-body text-on-surface-variant">{step.purpose}</p>
                                <ul className="space-y-2 text-sm text-on-surface">
                                    {step.checks.map((check) => (
                                        <li key={check} className="rounded-lg border border-outline-variant bg-surface px-md py-sm">
                                            <span className="font-mono text-mono">{check}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        </div>
                    </article>
                ))}
            </section>

            <section className="grid gap-lg md:grid-cols-2 xl:grid-cols-4">
                <article className="rounded-2xl border border-outline-variant bg-surface-container-lowest p-lg shadow-ambient">
                    <h2 className="font-h3 text-h3 text-on-background mb-sm">{t('howTo.normalization')}</h2>
                    <ul className="space-y-2 text-sm text-on-surface">
                        <li>{t('howTo.entrypointFile')}: <span className="font-mono">{guide.normalizationRules.entrypointFile}</span></li>
                        <li>{t('howTo.normalizeOnlyWhenNeeded')}: {guide.normalizationRules.normalizeOnlyWhenNeeded ? t('common.yes') : t('common.no')}</li>
                        <li>{t('howTo.preserveUsefulSubfolders')}: {guide.normalizationRules.preserveUsefulSubfolders ? t('common.yes') : t('common.no')}</li>
                        <li>{t('howTo.transparentToSubmitter')}: {guide.normalizationRules.transparentToSubmitter ? t('common.yes') : t('common.no')}</li>
                    </ul>
                </article>

                <article className="rounded-2xl border border-outline-variant bg-surface-container-lowest p-lg shadow-ambient">
                    <h2 className="font-h3 text-h3 text-on-background mb-sm">{t('howTo.escalationRule')}</h2>
                    <p className="font-body text-body text-on-surface-variant">{guide.escalationRule}</p>
                    {guide.uploadGuardrails.length > 0 && (
                        <ul className="mt-md space-y-2 text-sm text-on-surface">
                            {guide.uploadGuardrails.map((rule) => (
                                <li key={rule} className="rounded-lg border border-outline-variant bg-surface px-md py-sm">
                                    {rule}
                                </li>
                            ))}
                        </ul>
                    )}
                </article>

                <article className="rounded-2xl border border-outline-variant bg-surface-container-lowest p-lg shadow-ambient">
                    <h2 className="font-h3 text-h3 text-on-background mb-sm">{t('howTo.packageHandling')}</h2>
                    <p className="font-body text-body text-on-surface-variant">{guide.packageHandling.principle}</p>
                    <p className="mt-md text-sm font-medium text-on-surface">{t('howTo.doNotUpload')}</p>
                    <ul className="mt-2 space-y-2 text-sm text-on-surface">
                        {guide.packageHandling.disallowedInstalledPaths.map((path) => (
                            <li key={path} className="rounded-lg border border-outline-variant bg-surface px-md py-sm font-mono text-mono">
                                {path}
                            </li>
                        ))}
                    </ul>
                    <p className="mt-md text-sm font-medium text-on-surface">{t('howTo.allowedManifestFiles')}</p>
                    <p className="mt-2 text-sm text-on-surface-variant">
                        {guide.packageHandling.allowedManifestFiles.join(', ')}
                    </p>
                    <p className="mt-md text-sm text-on-surface-variant">{guide.packageHandling.submitterResponsibility}</p>
                </article>

                <article className="rounded-2xl border border-outline-variant bg-surface-container-lowest p-lg shadow-ambient">
                    <h2 className="font-h3 text-h3 text-on-background mb-sm">{t('howTo.uploadLimits')}</h2>
                    <ul className="space-y-2 text-sm text-on-surface">
                        <li>{t('howTo.maxFiles')}: {guide.uploadLimits.maxFiles}</li>
                        <li>{t('howTo.maxFileSizeBytes')}: <span className="font-mono">{guide.uploadLimits.maxFileSizeBytes}</span></li>
                    </ul>
                    <p className="mt-md text-sm font-medium text-on-surface">{t('howTo.blockedPaths')}</p>
                    <p className="mt-2 text-sm text-on-surface-variant">
                        {guide.uploadLimits.disallowedPaths.join(', ')}
                    </p>
                    <p className="mt-md text-sm font-medium text-on-surface">{t('howTo.finalization')}</p>
                    <p className="mt-2 text-sm text-on-surface-variant">
                        <span className="font-mono">{guide.uploadFinalization.finalizeEndpoint}</span>
                    </p>
                    <p className="mt-2 text-sm text-on-surface-variant">{guide.uploadFinalization.statusFollowUp}</p>
                </article>
            </section>
        </div>
    );
}
