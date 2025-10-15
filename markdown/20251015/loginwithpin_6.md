PS D:\mybazaar20> gcloud functions logs read loginWithPin --gen2 --region=us-central1 --start-time="2025-10-15T06:00:00Z" --end-time="2025-10-15T08:00:00Z"
LEVEL  NAME          EXECUTION_ID  TIME_UTC                 LOG
       loginwithpin  rotlltx5463w  2025-10-15 07:46:48.326  [getRedirectUrl] Checking roles: ["customer"]
       loginwithpin  rotlltx5463w  2025-10-15 07:46:48.326  [h1hg8q] ===== LOGIN REQUEST END =====
       loginwithpin  rotlltx5463w  2025-10-15 07:46:48.326  [h1hg8q] ? Login successful in 2276ms
       loginwithpin  rotlltx5463w  2025-10-15 07:46:48.325  [h1hg8q] ? Custom token created (length: 891)
       loginwithpin  rotlltx5463w  2025-10-15 07:46:48.255  [h1hg8q] ? Creating custom token...
       loginwithpin  rotlltx5463w  2025-10-15 07:46:48.255  [h1hg8q] ?? Auth configuration not found. Skipping getUser/createUser and proceeding to custom token only.
       loginwithpin  rotlltx5463w  2025-10-15 07:46:48.146  [h1hg8q] ? Checking if auth user exists...
       loginwithpin  rotlltx5463w  2025-10-15 07:46:48.146  [h1hg8q] ? AuthUid: phone_60123456789
       loginwithpin  rotlltx5463w  2025-10-15 07:46:48.145  [h1hg8q] ? Password verified   
       loginwithpin  rotlltx5463w  2025-10-15 07:46:48.145  [h1hg8q] ? Computing password hash...
       loginwithpin  rotlltx5463w  2025-10-15 07:46:48.145  [h1hg8q] ? User data structure: {
                                                              id: 'phone_60123456789',     
                                                              hasBasicInfo: true,
                                                              phoneNumber: '0123456789',   
                                                              hasPasswordHash: true,       
                                                              hasPinHash: false,
                                                              hasPasswordSalt: true,       
                                                              hasPinSalt: false,
                                                              roles: [ 'customer' ],       
                                                              topLevelKeys: [
                                                                'authUid',
                                                                'roles',
                                                                'identityTag',
                                                                'basicInfo',
                                                                'roleSpecificData',        
                                                                'accountStatus'
                                                              ]
                                                            }
       loginwithpin  rotlltx5463w  2025-10-15 07:46:48.144  [h1hg8q] ? Found user with variant: 0123456789, Doc ID: phone_60123456789
       loginwithpin  rotlltx5463w  2025-10-15 07:46:48.144  [h1hg8q] Query result for 0123456789: 1 documents
       loginwithpin  rotlltx5463w  2025-10-15 07:46:47.132  [h1hg8q] ? Querying with variant: 0123456789
       loginwithpin  rotlltx5463w  2025-10-15 07:46:47.132  [h1hg8q] Query result for 123456789: 0 documents
       loginwithpin  rotlltx5463w  2025-10-15 07:46:46.052  [h1hg8q] ? Querying with variant: 123456789
       loginwithpin  rotlltx5463w  2025-10-15 07:46:46.051  [h1hg8q] ? Trying phone variants: [
                                                              '123456789',
                                                              '0123456789',
                                                              '60123456789',
                                                              '+60123456789',
                                                              '0123456789'
                                                            ]
       loginwithpin  rotlltx5463w  2025-10-15 07:46:46.051  [h1hg8q] ? Collection path: organizations/fVqHtUWjh58HVJu5cMAn/events/zcaWnsF3zTNeqZ738x2V/users
       loginwithpin  rotlltx5463w  2025-10-15 07:46:46.051  [h1hg8q] ? Normalized phone: 123456789
       loginwithpin  rotlltx5463w  2025-10-15 07:46:46.051  [h1hg8q] ? Received data: {    
                                                              phoneNumber: '012***',       
                                                              hasPin: true,
                                                              pinLength: 8,
                                                              organizationId: 'fVqHtUWjh58HVJu5cMAn',
                                                              eventId: 'zcaWnsF3zTNeqZ738x2V'
                                                            }