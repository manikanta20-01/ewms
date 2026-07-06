namespace ewms.db.common;

using {managed} from '@sap/cds/common';

/*
 * Base entity for all master data
 */
aspect MasterData : managed {

    code        : String(20);

    name        : String(100);

    description : String(255);

    status      : String(20) default 'Active';

}
