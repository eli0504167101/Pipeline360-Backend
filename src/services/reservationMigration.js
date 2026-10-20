// Work directly with the supplied database: no model imports, DDL, or user matching.
async function reportOwnership(database) {
    const [result] = await database.collection('reservations').aggregate([
        { $facet: {
            total: [{ $count: 'count' }],
            missingOwner: [{ $match: { userId: { $exists: false } } }, { $count: 'count' }],
            nullOwner: [{ $match: { $expr: { $eq: [{ $type: '$userId' }, 'null'] } } }, { $count: 'count' }],
            owned: [{ $match: { $expr: { $eq: [{ $type: '$userId' }, 'objectId'] } } }, { $count: 'count' }],
            invalidOwnerType: [{ $match: { $expr: { $not: [{ $in: [{ $type: '$userId' }, ['missing', 'null', 'objectId']] }] } } }, { $count: 'count' }],
            orphanedOwner: [
                { $match: { $expr: { $eq: [{ $type: '$userId' }, 'objectId'] } } },
                { $lookup: { from: 'users', localField: 'userId', foreignField: '_id', as: 'owner' } },
                { $match: { owner: { $size: 0 } } }, { $count: 'count' }
            ]
        } }
    ], { readPreference: 'primary', maxTimeMS: 30000 }).toArray();
    return Object.fromEntries(Object.entries(result).map(([key, counts]) => [key, counts[0]?.count || 0]));
}
async function migrateReservationOwnership(database, { apply = false } = {}) {
    const before = await reportOwnership(database);
    let modified = 0;
    if (apply) {
        const result = await database.collection('reservations').updateMany(
            { userId: { $exists: false } }, { $set: { userId: null } },
            { writeConcern: { w: 'majority', wtimeoutMS: 5000 }, maxTimeMS: 30000 }
        );
        modified = result.modifiedCount;
    }
    return { mode: apply ? 'apply' : 'dry-run', before, modified,
        after: apply ? await reportOwnership(database) : before };
}
module.exports = { reportOwnership, migrateReservationOwnership };
