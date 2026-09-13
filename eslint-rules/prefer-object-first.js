'use strict';

function receiverName(node) {
    if (node.type === 'Identifier') return node.name;
    if (node.type === 'ThisExpression') return 'this';
    if (node.type === 'MemberExpression' && !node.computed) {
        const prefix = receiverName(node.object);
        return prefix && `${prefix}.${node.property.name}`;
    }
    return null;
}
module.exports = {
    meta: {
        type: 'suggestion',
        docs: { description: 'Keep interpolated Pino log fields searchable with an object-first call.' },
        fixable: 'code',
        schema: [{ type: 'object', properties: {
            loggerNames: { type: 'array', items: { type: 'string' }, uniqueItems: true },
        }, additionalProperties: false }],
        messages: { structured: 'Pass searchable fields as the first argument to this logger.' },
    },
    create(context) {
        const names = new Set(context.options[0]?.loggerNames || ['log', 'logger', 'req.log', 'request.log', 'app.log', 'fastify.log']);
        const methods = new Set(['trace', 'debug', 'info', 'warn', 'error', 'fatal']);
        const source = context.sourceCode;
        function constantPrimitive(identifier) {
            let scope = source.getScope(identifier);
            let variable;
            while (scope && !variable) { variable = scope.set.get(identifier.name); scope = scope.upper; }
            const def = variable?.defs[0];
            return variable?.defs.length === 1 && def?.parent?.kind === 'const'
                && def.node.id.type === 'Identifier' && def.node.init?.type === 'Literal'
                && !def.node.init.regex && typeof def.node.init.value !== 'object';
        }
        return {
            CallExpression(node) {
                const callee = node.callee;
                if (callee.type !== 'MemberExpression' || callee.computed
                    || !methods.has(callee.property.name) || !names.has(receiverName(callee.object))) return;
                const template = node.arguments[0];
                if (template?.type !== 'TemplateLiteral' || !template.expressions.length) return;
                const canFix = node.arguments.length === 1 && template.expressions.every(expr =>
                    expr.type === 'Identifier' && expr.name !== '__proto__' && constantPrimitive(expr));
                context.report({ node: template, messageId: 'structured',
                    // Keep the original message and its formatting. Only duplicate reads
                    // of known primitive consts; calls/getters/mutable bindings need review.
                    fix: canFix ? fixer => fixer.insertTextBefore(template,
                        `{ ${[...new Set(template.expressions.map(expr => expr.name))].join(', ')} }, `) : undefined,
                });
            },
        };
    },
};
