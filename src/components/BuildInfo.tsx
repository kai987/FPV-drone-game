import { BUILD_INFO } from '../game/build-info';
import { useI18n } from '../i18n/context';

export default function BuildInfo() {
  const { t } = useI18n();
  return <div className="build-info" data-testid="build-info">
    <span>{t('版本信息')} · <code>{BUILD_INFO.buildId}</code></span>
    {BUILD_INFO.sourceRevision && !BUILD_INFO.sourceDirty && BUILD_INFO.sourceRepository ? <a
      href={`${BUILD_INFO.sourceRepository}/commit/${BUILD_INFO.sourceRevision}`}
      target="_blank" rel="noreferrer">{t('源码版本')} ↗</a> : <span>
      {BUILD_INFO.sourceRevision && BUILD_INFO.sourceDirty ? t('包含未提交更改')
        : `${t('源码版本')} · ${BUILD_INFO.sourceRevision?.slice(0, 8) ?? '—'}`}
    </span>}
  </div>;
}
