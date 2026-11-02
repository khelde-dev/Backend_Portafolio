/**
 * Doble generico de `db` (drizzle) para tests. Los controllers de este
 * repo solo hacen tres formas de query: cadenas `select().from()...` que
 * terminan en `.all()` o se awaitan directo, `insert().values().returning()`,
 * y `update().set().where().returning()` (mas `delete()` y `transaction()`
 * desde la Fase 4b). Drizzle's query builders son "thenables" (resuelven
 * al awaitarlos directamente, sin necesitar `.all()`) - este doble imita
 * esa forma sin tener que re-implementar cada metodo real: cualquier
 * propiedad encadenada devuelve otro eslabon encadenable, y `await` en
 * cualquier punto de la cadena resuelve al resultado que el test haya
 * configurado con `setFakeDbResult`.
 *
 * Por que un mock y no golpear Turso real en los tests: los tests que
 * escriben (POST/PUT/DELETE) insertarian/modificarian filas reales en la
 * base de produccion en cada corrida (incluyendo cada `pre-push`) -
 * inaceptable. Ver docs/00-auditoria.md, seccion de testing.
 */

// biome-ignore lint/suspicious/noExplicitAny: doble generico deliberado, ver comentario del modulo
type Chainable = any;

const state: { current: unknown; error: unknown } = {
	current: [],
	error: null,
};

// Hace que la siguiente consulta falle (para probar el manejo de errores
// internos sin necesitar una base rota). `null` lo desactiva.
export const setFakeDbError = (error: unknown): void => {
	state.error = error;
};

// Historial completo de llamadas a `.values(...)`/`.set(...)`, no solo la
// ultima - un controller como CreateProject hace DOS inserts en la misma
// transaccion (fila principal + traducciones), y quedarse solo con "la
// ultima" pisaba la primera silenciosamente. `getLastInsertValues()` se
// mantiene como azucar sobre el ultimo elemento para no romper los tests
// que ya la usaban con un solo insert.
const insertCalls: unknown[] = [];
const updateCalls: unknown[] = [];

export const setFakeDbResult = (value: unknown): void => {
	state.current = value;
};

// Limpia el historial de llamadas entre tests - evita que una asercion
// de `getInsertCalls()` en un test vea llamadas de un test anterior que
// no llamo a esto.
export const resetFakeDbCalls = (): void => {
	insertCalls.length = 0;
	updateCalls.length = 0;
};

export const getInsertCalls = (): unknown[] => insertCalls;
export const getUpdateCalls = (): unknown[] => updateCalls;
export const getLastInsertValues = (): unknown =>
	insertCalls[insertCalls.length - 1];
export const getLastUpdateValues = (): unknown =>
	updateCalls[updateCalls.length - 1];

const chainable = (): Chainable => {
	const target = (..._args: unknown[]) => chainable();
	return new Proxy(target, {
		get(_t, prop) {
			if (prop === "then") {
				return (
					resolve: (v: unknown) => void,
					reject?: (e: unknown) => void,
				) =>
					state.error && reject ? reject(state.error) : resolve(state.current);
			}
			if (prop === "values") {
				return (arg: unknown) => {
					insertCalls.push(arg);
					return chainable();
				};
			}
			if (prop === "set") {
				return (arg: unknown) => {
					updateCalls.push(arg);
					return chainable();
				};
			}
			return () => chainable();
		},
	});
};

interface FakeQueryBuilder {
	select: (..._args: unknown[]) => Chainable;
	insert: (..._args: unknown[]) => Chainable;
	update: (..._args: unknown[]) => Chainable;
	delete: (..._args: unknown[]) => Chainable;
}

const baseFakeDb: FakeQueryBuilder = {
	select: (..._args: unknown[]) => chainable(),
	insert: (..._args: unknown[]) => chainable(),
	update: (..._args: unknown[]) => chainable(),
	delete: (..._args: unknown[]) => chainable(),
};

export const fakeDb: FakeQueryBuilder & {
	transaction: <T>(cb: (tx: FakeQueryBuilder) => Promise<T>) => Promise<T>;
} = {
	...baseFakeDb,
	// `tx` es el mismo doble - comparte estado con `db` (mismo
	// `state.current`/historial de llamadas), suficiente para probar que
	// el controller llama a los metodos correctos dentro de la
	// transaccion, no para probar aislamiento real (eso solo lo prueba
	// Turso real, ver la verificacion end-to-end en los docs de cada fase).
	transaction: async <T>(
		cb: (tx: FakeQueryBuilder) => Promise<T>,
	): Promise<T> => cb(baseFakeDb),
};
