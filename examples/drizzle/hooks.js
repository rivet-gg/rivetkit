export async function load(url, context, nextLoad) {
    if(url.endsWith('.sql')) {
        return {
            shortCircuit: true,
            format: 'module',
            source: `export default 'SQL file loaded from ${url}';`
        }
    }
    return nextLoad(url, context)
} 