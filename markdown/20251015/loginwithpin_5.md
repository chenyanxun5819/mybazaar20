PS D:\mybazaar20> firebase functions:log --only loginWithPin                               
2025-10-15T06:52:33.855559Z ? loginwithpin: [juux5v] 🔎 Querying with variant: 0123456789

2025-10-15T06:52:34.137246Z ? loginwithpin: [juux5v] Query result for 0123456789: 1 documents

2025-10-15T06:52:34.137395Z ? loginwithpin: [juux5v] ✅ Found user with variant: 0123456789, Doc ID: phone_60123456789

2025-10-15T06:52:34.138120Z ? loginwithpin: [juux5v] 📄 User data structure: {
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

2025-10-15T06:52:34.138150Z ? loginwithpin: [juux5v] 🔒 Computing password hash...

2025-10-15T06:52:34.138235Z ? loginwithpin: [juux5v] ✅ Password verified

2025-10-15T06:52:34.138274Z ? loginwithpin: [juux5v] 🔑 AuthUid: phone_60123456789

2025-10-15T06:52:34.138297Z ? loginwithpin: [juux5v] 🔍 Checking if auth user exists...    

2025-10-15T06:52:34.262862Z ? loginwithpin: [juux5v] ❌ Error checking auth user: FirebaseAuthError: There is no configuration corresponding to the provided identifier.
    at FirebaseAuthError.fromServerError (/workspace/node_modules/firebase-admin/lib/utils/error.js:148:16)
    at /workspace/node_modules/firebase-admin/lib/auth/auth-api-request.js:1629:49
    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)
    at async /workspace/index.js:206:22 {
  errorInfo: {
    code: 'auth/configuration-not-found',
    message: 'There is no configuration corresponding to the provided identifier.'
  },
  codePrefix: 'auth'
}

2025-10-15T06:52:34.263355Z ? loginwithpin: [juux5v] ❌ ERROR after 2507ms: {
  name: 'Error',
  message: 'There is no configuration corresponding to the provided identifier.',
  code: 'auth/configuration-not-found',
  stack: 'Error: There is no configuration corresponding to the provided identifier.\n' +  
    '    at FirebaseAuthError.fromServerError (/workspace/node_modules/firebase-admin/lib/utils/error.js:148:16)\n' +
    '    at /workspace/node_modules/firebase-admin/lib/auth/auth-api-request.js:1629:49\n' +
    '    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)\n' +
    '    at async /workspace/index.js:206:22'
}

2025-10-15T07:20:18.831604294Z N loginWithPin: {"@type":"type.googleapis.com/google.cloud.audit.AuditLog","authenticationInfo":{"principalEmail":"weschen@mybazaar.my","principalSubject":"user:weschen@mybazaar.my","oauthInfo":{"oauthClientId":"563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com"}},"requestMetadata":{"callerIp":"118.100.227.105","callerSuppliedUserAgent":"FirebaseCLI/14.19.1,gzip(gfe),gzip(gfe)","requestAttributes":{"time":"2025-10-15T07:20:18.050338083Z","auth":{}},"destinationAttributes":{}},"serviceName":"cloudfunctions.googleapis.com","methodName":"google.cloud.functions.v2.FunctionService.UpdateFunction","authorizationInfo":[{"resource":"projects/mybazaar-c4881/locations/us-central1/functions/loginWithPin","permission":"cloudfunctions.functions.update","granted":true,"resourceAttributes":{"service":"cloudfunctions.googleapis.com","name":"projects/mybazaar-c4881/locations/us-central1/functions/loginWithPin","type":"cloudfunctions.googleapis.com/Function"},"permissionType":"ADMIN_WRITE"}],"resourceName":"projects/mybazaar-c4881/locations/us-central1/functions/loginWithPin","request":{"update_mask":{"paths":["name","build_config.runtime","build_config.entry_point","build_config.source.storage_source.bucket","build_config.source.storage_source.object","build_config.environment_variables","build_config.source_token","service_config.environment_variables","service_config.ingress_settings","service_config.timeout_seconds","service_config.service_account_email","service_config.available_memory","service_config.min_instance_count","service_config.max_instance_count","service_config.max_instance_request_concurrency","service_config.available_cpu","service_config.vpc_connector","service_config.vpc_connector_egress_settings","labels"]},"function":{"labels":{"firebase-functions-hash":"8e0702270b3076689df6ac81644dc5444cfbcf6c","deployment-tool":"cli-firebase"},"build_config":{"source":{},"entry_point":"loginWithPin","runtime":"nodejs22","source_token":"Clhwcm9qZWN0cy8xMDY5MzI2MDM0NTgxL2xvY2F0aW9ucy91cy1jZW50cmFsMS9idWlsZHMvNDRmYmFlZTMtMmRkMy00NjRmLTlkZTMtNWUxMzcyZDVlYmJhEnN1cy1jZW50cmFsMS1kb2NrZXIucGtnLmRldi9teWJhemFhci1jNDg4MS9nY2YtYXJ0aWZhY3RzL215YmF6YWFyLS1jNDg4MV9fdXMtLWNlbnRyYWwxX19jaGVja19hZG1pbl9leGlzdHM6dmVyc2lvbl8xGJXNscaPHyJIcHJvamVjdHMvbXliYXphYXItYzQ4ODEvbG9jYXRpb25zL3VzLWNlbnRyYWwxL2Z1bmN0aW9ucy9jaGVja0FkbWluRXhpc3RzKgwIp5a9xwYQyJS/6wIyCG5vZGVqczIyOnYKI2djci5pby9nYWUtcnVudGltZXMvbm9kZWpzMjI6c3RhYmxlEk91cy1jZW50cmFsMS1kb2NrZXIucGtnLmRldi9zZXJ2ZXJsZXNzLXJ1bnRpbWVzL2dvb2dsZS0yMi1mdWxsL3J1bnRpbWVzL25vZGVqczIyQAE="},"name":"projects/mybazaar-c4881/locations/us-central1/functions/loginWithPin","service_config":{"available_memory":"256Mi","max_instance_request_concurrency":80,"available_cpu":"1"}},"@type":"type.googleapis.com/google.cloud.functions.v2.UpdateFunctionRequest"},"response":{"@type":"type.googleapis.com/google.longrunning.Operation"},"resourceLocation":{"currentLocations":["us-central1"]}}
2025-10-15T07:20:22.630068Z I loginwithpin: Starting new instance. Reason: DEPLOYMENT_ROLLOUT - Instance started due to traffic shifting between revisions due to deployment, traffic split adjustment, or deployment health check.
2025-10-15T07:20:24.345133Z I loginwithpin: Default STARTUP TCP probe succeeded after 1 attempt for container "worker" on port 8080.
2025-10-15T07:20:46.020572025Z N loginWithPin: {"@type":"type.googleapis.com/google.cloud.audit.AuditLog","status":{},"authenticationInfo":{"principalEmail":"weschen@mybazaar.my","principalSubject":"user:weschen@mybazaar.my","oauthInfo":{"oauthClientId":"563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com"}},"requestMetadata":{"requestAttributes":{},"destinationAttributes":{}},"serviceName":"cloudfunctions.googleapis.com","methodName":"google.cloud.functions.v2.FunctionService.UpdateFunction","resourceName":"projects/mybazaar-c4881/locations/us-central1/functions/loginWithPin","response":{"labels":{"firebase-functions-hash":"8e0702270b3076689df6ac81644dc5444cfbcf6c","deployment-tool":"cli-firebase"},"name":"projects/mybazaar-c4881/locations/us-central1/functions/loginWithPin","buildConfig":{"dockerRegistry":"ARTIFACT_REGISTRY","dockerRepository":"projects/mybazaar-c4881/locations/us-central1/repositories/gcf-artifacts","automaticUpdatePolicy":{},"source":{},"serviceAccount":"projects/mybazaar-c4881/serviceAccounts/1069326034581-compute@developer.gserviceaccount.com","runtime":"nodejs22","entryPoint":"loginWithPin"},"url":"https://us-central1-mybazaar-c4881.cloudfunctions.net/loginWithPin","serviceConfig":{"serviceAccountEmail":"1069326034581-compute@developer.gserviceaccount.com","availableMemory":"256Mi","allTrafficOnLatestRevision":true,"timeoutSeconds":60,"availableCpu":"1","uri":"https://loginwithpin-zgmq4nw2bq-uc.a.run.app","maxInstanceCount":20,"revision":"loginwithpin-00009-yub","maxInstanceRequestConcurrency":80,"ingressSettings":"ALLOW_ALL"},"createTime":"2025-10-14T11:15:55.756169123Z","state":"ACTIVE","satisfiesPzi":true,"@type":"type.googleapis.com/google.cloud.functions.v2.Function","updateTime":"2025-10-15T07:20:18.817169225Z","environment":"GEN_2"},"resourceLocation":{"currentLocations":["us-central1"]}}
2025-10-15T07:28:30.060307Z I loginwithpin: