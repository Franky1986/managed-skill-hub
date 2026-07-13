import { FormEvent, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { adminApi } from '../../api/admin';
import { handleApiError } from '../../api/client';
import { skillsApi } from '../../api/skills';
import { useLanguage } from '../../i18n';

export function AdminSkillCreatePage() {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const { language, t } = useLanguage();
    const [title, setTitle] = useState('');
    const [skillId, setSkillId] = useState('');
    const [description, setDescription] = useState('');
    const [category, setCategory] = useState('');
    const [tags, setTags] = useState('');
    const [entrypoint, setEntrypoint] = useState('README.md');
    const [categories, setCategories] = useState<string[]>([]);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const proposalId = searchParams.get('proposalId');

    useEffect(() => {
        skillsApi.listCategories()
            .then((response) => {
                const items = response.data.items ?? [];
                setCategories(items);
                setCategory((current) => current || items[0] || '');
            })
            .catch(() => {
                setCategories([]);
            });
    }, []);

    useEffect(() => {
        if (!proposalId) {
            return;
        }

        adminApi.getProposal(proposalId)
            .then((response) => {
                const proposal = response.data;
                setTitle((current) => current || proposal.title);
                setSkillId((current) => current || proposal.conversion.targetSkillId);
                setDescription((current) => current || proposal.description);
                setCategory((current) => current || proposal.category);
                setTags((current) => current || proposal.tags.join(', '));
                setEntrypoint((current) => current || proposal.conversion.targetEntrypoint || proposal.entrypoint || 'SKILL.md');
            })
            .catch(() => {
                // Keep manual creation flow usable even when proposal prefill fails.
            });
    }, [proposalId]);

    useEffect(() => {
        if (!title.trim()) {
            return;
        }
        const timer = window.setTimeout(async () => {
            try {
                const response = await skillsApi.suggestName(title, description);
                setSkillId((current) => current || response.data.suggestion);
            } catch {
                // Keep manual input unchanged when suggestion fails.
            }
        }, 300);

        return () => window.clearTimeout(timer);
    }, [title, description]);

    async function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setSubmitting(true);
        setError(null);
        try {
            const response = await adminApi.createSkill({
                id: skillId,
                title,
                description,
                category,
                tags: parseCommaList(tags),
                entrypoint,
            });
            navigate(`/admin/skills/${response.data.id}`);
        } catch (submitError) {
            setError(handleApiError(submitError, language));
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-semibold">{t('adminSkillCreate.title')}</h1>
                <p className="text-sm text-gray-600">
                    {t('adminSkillCreate.copy')}
                </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4 rounded border bg-white p-4">
                <label className="block text-sm">
                    {t('proposalStatus.fieldTitle')}
                    <input
                        value={title}
                        onChange={(event) => setTitle(event.target.value)}
                        className="mt-1 w-full rounded border px-3 py-2"
                        required
                    />
                </label>

                <label className="block text-sm">
                    {t('adminSkillCreate.skillId')}
                    <input
                        value={skillId}
                        onChange={(event) => setSkillId(event.target.value)}
                        className="mt-1 w-full rounded border px-3 py-2"
                        required
                    />
                </label>

                <label className="block text-sm">
                    {t('adminSkillCreate.description')}
                    <textarea
                        value={description}
                        onChange={(event) => setDescription(event.target.value)}
                        className="mt-1 min-h-32 w-full rounded border px-3 py-2"
                        required
                    />
                </label>

                <label className="block text-sm">
                    {t('proposalDetail.category')}
                    <input
                        list="skill-categories"
                        value={category}
                        onChange={(event) => setCategory(event.target.value)}
                        className="mt-1 w-full rounded border px-3 py-2"
                        required
                    />
                    <datalist id="skill-categories">
                        {categories.map((item) => (
                            <option key={item} value={item} />
                        ))}
                    </datalist>
                </label>

                <label className="block text-sm">
                    Tags
                    <input
                        value={tags}
                        onChange={(event) => setTags(event.target.value)}
                        className="mt-1 w-full rounded border px-3 py-2"
                        placeholder="comma,separated,tags"
                    />
                </label>

                <label className="block text-sm">
                    Entrypoint
                    <input
                        value={entrypoint}
                        onChange={(event) => setEntrypoint(event.target.value)}
                        className="mt-1 w-full rounded border px-3 py-2"
                        required
                    />
                </label>

                {error && <p className="text-sm text-red-600">{error}</p>}

                <div className="flex justify-end">
                    <button
                        type="submit"
                        disabled={submitting}
                        className="rounded bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-50"
                    >
                        {t('adminSkillCreate.create')}
                    </button>
                </div>
            </form>
        </div>
    );
}

function parseCommaList(value: string): string[] {
    return value.split(',').map((item) => item.trim()).filter(Boolean);
}
