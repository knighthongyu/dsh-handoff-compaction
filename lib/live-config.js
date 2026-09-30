import { HANDOFF_DEFAULTS, resolveHandoffConfig } from './config.js';
export function plainHandoffConfig(config) {
    const { maxTokens, retainTokens, retainRatio, ...rest } = config;
    return {
        ...rest,
        ...(maxTokens.get() === undefined ? {} : { maxTokens: maxTokens.get() }),
        ...(retainTokens.get() === undefined ? {} : { retainTokens: retainTokens.get() }),
        ...(retainRatio.get() === undefined ? {} : { retainRatio: retainRatio.get() }),
    };
}
/** Keep the existing engine and its listeners; every policy read gets a detached snapshot. */
export function bindLiveBudgets(engine, config) {
    const initial = engine.config;
    Object.defineProperty(engine, 'config', {
        configurable: true,
        get: () => {
            const { retainTokens: _tokens, retainRatio: _ratio, ...stable } = initial;
            const current = resolveHandoffConfig(plainHandoffConfig(config));
            return Object.freeze({
                ...stable,
                maxTokens: current.maxTokens ?? HANDOFF_DEFAULTS.maxTokens,
                ...(current.retainTokens === undefined
                    ? { retainRatio: current.retainRatio }
                    : { retainTokens: current.retainTokens }),
            });
        },
    });
}
//# sourceMappingURL=live-config.js.map