import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';
import i18n from '../i18n';

// Deterministic UI language for text queries.
void i18n.changeLanguage('zh-CN');
// Lazy route compilation can exceed the default 1s under concurrent Windows test workers.
configure({ asyncUtilTimeout: 3000 });

afterEach(() => cleanup());
