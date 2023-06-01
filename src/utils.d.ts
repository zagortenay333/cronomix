// This is a crappy way of making an object recursively readonly.
// It doesn't work for every kind of type, just the most commonly used.
type Immutable<T> =
    T extends Function | boolean | number | string | null | undefined ? T :
    T extends Map<infer K, infer V> ? ReadonlyMap<Immutable<K>, Immutable<V>> :
    T extends Set<infer S> ? ReadonlySet<Immutable<S>> :
    { readonly [P in keyof T]: Immutable<T[P]> }

// Use this type to define polymorphic procedures that
// take a class as input and return the object instance:
//
//     function foo <T extends BaseClass> (ctor: Newable<T>): T {
//         return new ctor();
//     }
//
type Newable<T> = {
    new (...args: unknown[]): T;
};
