PS D:\mybazaar20> firebase functions:log --only loginWithPin                               
2025-10-15T04:37:22.452549Z ? loginwithpin: [ti9vrk] Query result for 123456789: 0 documents

2025-10-15T04:37:22.452864Z ? loginwithpin: [ti9vrk] 🔎 Querying with variant: 0123456789

2025-10-15T04:37:22.715021Z ? loginwithpin: [ti9vrk] Query result for 0123456789: 1 documents

2025-10-15T04:37:22.715177Z ? loginwithpin: [ti9vrk] ✅ Found user with variant: 0123456789, Doc ID: phone_60123456789

2025-10-15T04:37:22.716119Z ? loginwithpin: [ti9vrk] 📄 User data structure: {
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

2025-10-15T04:37:22.716203Z ? loginwithpin: [ti9vrk] 🔒 Computing password hash...

2025-10-15T04:37:22.716357Z ? loginwithpin: [ti9vrk] ✅ Password verified

2025-10-15T04:37:22.716446Z ? loginwithpin: [ti9vrk] 🔑 AuthUid: phone_60123456789

2025-10-15T04:37:22.716525Z ? loginwithpin: [ti9vrk] 🔍 Checking if auth user exists...    

2025-10-15T04:37:22.835936Z ? loginwithpin: [ti9vrk] ❌ Error checking auth user: FirebaseAuthError: There is no configuration corresponding to the provided identifier.
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

2025-10-15T04:37:22.836521Z ? loginwithpin: [ti9vrk] ❌ ERROR after 2297ms: {
  name: 'Error',
  message: 'There is no configuration corresponding to the provided identifier.',
  code: 'auth/configuration-not-found',
  stack: 'Error: There is no configuration corresponding to the provided identifier.\n' +  
    '    at FirebaseAuthError.fromServerError (/workspace/node_modules/firebase-admin/lib/utils/error.js:148:16)\n' +
    '    at /workspace/node_modules/firebase-admin/lib/auth/auth-api-request.js:1629:49\n' +
    '    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)\n' +
    '    at async /workspace/index.js:206:22'
}

2025-10-15T06:51:41.444553733Z N loginWithPin: {"@type":"type.googleapis.com/google.cloud.audit.AuditLog","authenticationInfo":{"principalEmail":"weschen@mybazaar.my","principalSubject":"user:weschen@mybazaar.my","oauthInfo":{"oauthClientId":"563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com"}},"requestMetadata":{"callerIp":"118.100.227.105","callerSuppliedUserAgent":"FirebaseCLI/14.19.1,gzip(gfe),gzip(gfe)","requestAttributes":{"time":"2025-10-15T06:51:40.563826776Z","auth":{}},"destinationAttributes":{}},"serviceName":"cloudfunctions.googleapis.com","methodName":"google.cloud.functions.v2.FunctionService.UpdateFunction","authorizationInfo":[{"resource":"projects/mybazaar-c4881/locations/us-central1/functions/loginWithPin","permission":"cloudfunctions.functions.update","granted":true,"resourceAttributes":{"service":"cloudfunctions.googleapis.com","name":"projects/mybazaar-c4881/locations/us-central1/functions/loginWithPin","type":"cloudfunctions.googleapis.com/Function"},"permissionType":"ADMIN_WRITE"}],"resourceName":"projects/mybazaar-c4881/locations/us-central1/functions/loginWithPin","request":{"function":{"labels":{"deployment-tool":"cli-firebase","firebase-functions-hash":"4c1045c88aaf8fcca6129d01a99951a17b60b61c"},"service_config":{"available_cpu":"1","available_memory":"256Mi","max_instance_request_concurrency":80},"name":"projects/mybazaar-c4881/locations/us-central1/functions/loginWithPin","build_config":{"source":{},"source_token":"Clhwcm9qZWN0cy8xMDY5MzI2MDM0NTgxL2xvY2F0aW9ucy91cy1jZW50cmFsMS9idWlsZHMvMjZhY2NiOTktOWE4Zi00NjIzLThlODEtNjU1Y2RjM2VhNzE1EnN1cy1jZW50cmFsMS1kb2NrZXIucGtnLmRldi9teWJhemFhci1jNDg4MS9nY2YtYXJ0aWZhY3RzL215YmF6YWFyLS1jNDg4MV9fdXMtLWNlbnRyYWwxX19jaGVja19hZG1pbl9leGlzdHM6dmVyc2lvbl8xGJXNscaPHyJIcHJvamVjdHMvbXliYXphYXItYzQ4ODEvbG9jYXRpb25zL3VzLWNlbnRyYWwxL2Z1bmN0aW9ucy9jaGVja0FkbWluRXhpc3RzKgsI94i9xwYQiKTFEzIIbm9kZWpzMjI6dgojZ2NyLmlvL2dhZS1ydW50aW1lcy9ub2RlanMyMjpzdGFibGUST3VzLWNlbnRyYWwxLWRvY2tlci5wa2cuZGV2L3NlcnZlcmxlc3MtcnVudGltZXMvZ29vZ2xlLTIyLWZ1bGwvcnVudGltZXMvbm9kZWpzMjJAAQ==","runtime":"nodejs22","entry_point":"loginWithPin"}},"update_mask":{"paths":["name","build_config.runtime","build_config.entry_point","build_config.source.storage_source.bucket","build_config.source.storage_source.object","build_config.environment_variables","build_config.source_token","service_config.environment_variables","service_config.ingress_settings","service_config.timeout_seconds","service_config.service_account_email","service_config.available_memory","service_config.min_instance_count","service_config.max_instance_count","service_config.max_instance_request_concurrency","service_config.available_cpu","service_config.vpc_connector","service_config.vpc_connector_egress_settings","labels"]},"@type":"type.googleapis.com/google.cloud.functions.v2.UpdateFunctionRequest"},"response":{"@type":"type.googleapis.com/google.longrunning.Operation"},"resourceLocation":{"currentLocations":["us-central1"]}}
2025-10-15T06:51:46.807843Z I loginwithpin: Starting new instance. Reason: DEPLOYMENT_ROLLOUT - Instance started due to traffic shifting between revisions due to deployment, traffic split adjustment, or deployment health check.
2025-10-15T06:51:48.538659Z I loginwithpin: Default STARTUP TCP probe succeeded after 1 attempt for container "worker" on port 8080.
2025-10-15T06:51:50.238307041Z N loginWithPin: {"@type":"type.googleapis.com/google.cloud.audit.AuditLog","status":{},"authenticationInfo":{"principalEmail":"weschen@mybazaar.my","principalSubject":"user:weschen@mybazaar.my","oauthInfo":{"oauthClientId":"563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com"}},"requestMetadata":{"requestAttributes":{},"destinationAttributes":{}},"serviceName":"cloudfunctions.googleapis.com","methodName":"google.cloud.functions.v2.FunctionService.UpdateFunction","resourceName":"projects/mybazaar-c4881/locations/us-central1/functions/loginWithPin","response":{"createTime":"2025-10-14T11:15:55.756169123Z","@type":"type.googleapis.com/google.cloud.functions.v2.Function","satisfiesPzi":true,"url":"https://us-central1-mybazaar-c4881.cloudfunctions.net/loginWithPin","environment":"GEN_2","state":"ACTIVE","buildConfig":{"dockerRegistry":"ARTIFACT_REGISTRY","entryPoint":"loginWithPin","dockerRepository":"projects/mybazaar-c4881/locations/us-central1/repositories/gcf-artifacts","automaticUpdatePolicy":{},"serviceAccount":"projects/mybazaar-c4881/serviceAccounts/1069326034581-compute@developer.gserviceaccount.com","source":{},"runtime":"nodejs22"},"name":"projects/mybazaar-c4881/locations/us-central1/functions/loginWithPin","labels":{"deployment-tool":"cli-firebase","firebase-functions-hash":"4c1045c88aaf8fcca6129d01a99951a17b60b61c"},"serviceConfig":{"revision":"loginwithpin-00008-gew","availableCpu":"1","allTrafficOnLatestRevision":true,"timeoutSeconds":60,"maxInstanceRequestConcurrency":80,"serviceAccountEmail":"1069326034581-compute@developer.gserviceaccount.com","maxInstanceCount":20,"uri":"https://loginwithpin-zgmq4nw2bq-uc.a.run.app","ingressSettings":"ALLOW_ALL","availableMemory":"256Mi"},"updateTime":"2025-10-15T06:51:41.428658739Z"},"resourceLocation":{"currentLocations":["us-central1"]}}