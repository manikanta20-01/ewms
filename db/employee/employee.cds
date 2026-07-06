namespace ewms.db.employee;

using { managed } from '@sap/cds/common';

using ewms.db.common as type from '../common/types';
using ewms.db.common as enums from '../common/enums';

using {ewms.db.employee.Bank} from  './bank';
using {ewms.db.employee.Education} from  './education';
using {ewms.db.employee.Document} from  './document';
using {ewms.db.employee.Experience} from  './experience';
using {ewms.db.employee.StatutoryDetail} from  './statutory-detail';

entity Employee : managed {

    key ID : UUID;

    employeeCode : type.BusinessCode;

    firstName : String(100);
    lastName  : String(100);

    email : type.Email;
    mobile : type.Phone;
    bloodGroup  : enums.BloodGroup;

    gender     : enums.Gender default 'Male';
    dateOfBirth : Date;

    joiningDate : Date;
    relievingDate : Date;
    totalExperience   : Decimal(4,1) default 0;

    photoUrl : String(500);

    employmentType : enums.EmploymentType default 'Permanent';

    workMode : enums.WorkMode default 'Office';

    // Photo
    photo : LargeBinary @Core.MediaType:'image/jpeg';
    photoFileName : String(255);

    // Permanent Address
    permanentAddress1 : String(255);
    permanentAddress2 : String(255);
    permanentCity : String(100);
    permanentState : String(100);
    permanentCountry : String(100);
    permanentPostalCode : String(10);

    // Current Address
    currentAddress1 : String(255);
    currentAddress2 : String(255);
    currentCity : String(100);
    currentState : String(100);
    currentCountry : String(100);
    currentPostalCode : String(10);

    // Emergency Contact
    emergencyContactName : String(100);
    emergencyRelationship : String(50);
    emergencyMobile : type.Phone;

    // Family
    fatherName : String(100);
    motherName : String(100);
    spouseName : String(100);

    status : enums.Status default 'Active';

    banks : Composition of many Bank
        on banks.employee = $self;

    educations : Composition of many Education
        on educations.employee = $self;

    experiences : Composition of many Experience
        on experiences.employee = $self;

    documents : Composition of many Document
        on documents.employee = $self;

    statutoryDetails : Composition of one StatutoryDetail
        on statutoryDetails.employee = $self;
}
