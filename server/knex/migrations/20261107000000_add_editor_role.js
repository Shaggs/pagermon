exports.up = function (db, Promise) {
    return db.schema.table('users', function (table) {
        table.enu('role', ['admin', 'editor', 'user']).notNullable().defaultTo('user').alter();
    });
};

exports.down = function (db, Promise) {
    return db.schema.table('users', function (table) {
        table.enu('role', ['admin', 'user']).notNullable().defaultTo('user').alter();
    });
};
