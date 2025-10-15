# 68ef063700084fecf6d8ee07
```
{
  "textPayload": "[5msz8k] ❌ ERROR after 2570ms: {\n  name: 'Error',\n  message: 'There is no configuration corresponding to the provided identifier.',\n  code: 'auth/configuration-not-found',\n  stack: 'Error: There is no configuration corresponding to the provided identifier.\\n' +\n    '    at FirebaseAuthError.fromServerError (/workspace/node_modules/firebase-admin/lib/utils/error.js:148:16)\\n' +\n    '    at /workspace/node_modules/firebase-admin/lib/auth/auth-api-request.js:1629:49\\n' +\n    '    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)\\n' +\n    '    at async /workspace/index.js:207:22'\n}\n",
  "insertId": "68ef063700084fecf6d8ee07",
  "resource": {
    "type": "cloud_run_revision",
    "labels": {
      "service_name": "loginwithpin",
      "configuration_name": "loginwithpin",
      "location": "us-central1",
      "project_id": "mybazaar-c4881",
      "revision_name": "loginwithpin-00006-hiz"
    }
  },
  "timestamp": "2025-10-15T02:25:59.544748Z",
  "labels": {
    "execution_id": "rdd0x8c3rj8l",
    "goog-managed-by": "cloudfunctions",
    "run.googleapis.com/base_image_versions": "us-docker.pkg.dev/serverless-runtimes/google-22-full/runtimes/nodejs22:nodejs22_20251005_22_20_0_RC00",
    "firebase-functions-hash": "4a978b93106eb02f408cc4d2ae68e0cac8f97d6d",
    "instanceId": "0069c7a9886362806a621a25347968ec75306616fa1045401a75cb4e0e90511d15a90879a8c5236c4d94dfe91442ab346347cd2c5b9cbb3be8c121614123e9edd5bf294e207d42b69c07314d91",
    "goog-drz-cloudfunctions-location": "us-central1",
    "goog-drz-cloudfunctions-id": "loginwithpin"
  },
  "logName": "projects/mybazaar-c4881/logs/run.googleapis.com%2Fstderr",
  "receiveTimestamp": "2025-10-15T02:25:59.881613243Z",
  "spanId": "9696527082194737745"
}
```

# 68ef063700084a8272a8afdf
```
{
  "textPayload": "[5msz8k] ❌ Error checking auth user: FirebaseAuthError: There is no configuration corresponding to the provided identifier.\n    at FirebaseAuthError.fromServerError (/workspace/node_modules/firebase-admin/lib/utils/error.js:148:16)\n    at /workspace/node_modules/firebase-admin/lib/auth/auth-api-request.js:1629:49\n    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)\n    at async /workspace/index.js:207:22 {\n  errorInfo: {\n    code: 'auth/configuration-not-found',\n    message: 'There is no configuration corresponding to the provided identifier.'\n  },\n  codePrefix: 'auth'\n}\n",
  "insertId": "68ef063700084a8272a8afdf",
  "resource": {
    "type": "cloud_run_revision",
    "labels": {
      "revision_name": "loginwithpin-00006-hiz",
      "project_id": "mybazaar-c4881",
      "service_name": "loginwithpin",
      "configuration_name": "loginwithpin",
      "location": "us-central1"
    }
  },
  "timestamp": "2025-10-15T02:25:59.543362Z",
  "labels": {
    "execution_id": "rdd0x8c3rj8l",
    "instanceId": "0069c7a9886362806a621a25347968ec75306616fa1045401a75cb4e0e90511d15a90879a8c5236c4d94dfe91442ab346347cd2c5b9cbb3be8c121614123e9edd5bf294e207d42b69c07314d91",
    "goog-drz-cloudfunctions-location": "us-central1",
    "goog-drz-cloudfunctions-id": "loginwithpin",
    "firebase-functions-hash": "4a978b93106eb02f408cc4d2ae68e0cac8f97d6d",
    "run.googleapis.com/base_image_versions": "us-docker.pkg.dev/serverless-runtimes/google-22-full/runtimes/nodejs22:nodejs22_20251005_22_20_0_RC00",
    "goog-managed-by": "cloudfunctions"
  },
  "logName": "projects/mybazaar-c4881/logs/run.googleapis.com%2Fstderr",
  "receiveTimestamp": "2025-10-15T02:25:59.548419632Z",
  "spanId": "9696527082194737745",
  "errorGroups": [
    {
      "id": "COX998Lv7OrwTA"
    }
  ]
}
```

# 68ef063700085a861e38cc60
```
{
  "insertId": "68ef063700085a861e38cc60",
  "httpRequest": {
    "requestMethod": "POST",
    "requestUrl": "https://us-central1-mybazaar-c4881.cloudfunctions.net/loginWithPin",
    "requestSize": "906",
    "status": 500,
    "responseSize": "386",
    "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
    "remoteIp": "115.135.205.111",
    "referer": "http://localhost:5173/",
    "serverIp": "216.239.36.54",
    "latency": "2.602287838s",
    "protocol": "HTTP/1.1"
  },
  "resource": {
    "type": "cloud_run_revision",
    "labels": {
      "project_id": "mybazaar-c4881",
      "revision_name": "loginwithpin-00006-hiz",
      "location": "us-central1",
      "service_name": "loginwithpin",
      "configuration_name": "loginwithpin"
    }
  },
  "timestamp": "2025-10-15T02:25:56.943333Z",
  "severity": "ERROR",
  "labels": {
    "goog-drz-cloudfunctions-location": "us-central1",
    "firebase-functions-hash": "4a978b93106eb02f408cc4d2ae68e0cac8f97d6d",
    "goog-drz-cloudfunctions-id": "loginwithpin",
    "goog-managed-by": "cloudfunctions",
    "instanceId": "0069c7a9886362806a621a25347968ec75306616fa1045401a75cb4e0e90511d15a90879a8c5236c4d94dfe91442ab346347cd2c5b9cbb3be8c121614123e9edd5bf294e207d42b69c07314d91"
  },
  "logName": "projects/mybazaar-c4881/logs/run.googleapis.com%2Frequests",
  "trace": "projects/mybazaar-c4881/traces/1cfb32c24a18378f0c7834bb46ae5ba3",
  "receiveTimestamp": "2025-10-15T02:25:59.698066384Z",
  "spanId": "8690fc01c12c1a51"
}
```
# 6d3rvzdv4fy
```
{
  "protoPayload": {
    "@type": "type.googleapis.com/google.cloud.audit.AuditLog",
    "authenticationInfo": {
      "principalEmail": "service-1069326034581@gcf-admin-robot.iam.gserviceaccount.com"
    },
    "requestMetadata": {
      "requestAttributes": {
        "time": "2025-10-15T02:20:35.602678Z",
        "auth": {}
      },
      "destinationAttributes": {}
    },
    "serviceName": "run.googleapis.com",
    "methodName": "google.cloud.serverless.internal.InternalServices.ReplaceInternalService",
    "authorizationInfo": [
      {
        "resource": "namespaces/mybazaar-c4881/services/loginwithpin",
        "permission": "run.services.update",
        "granted": true,
        "resourceAttributes": {},
        "permissionType": "ADMIN_WRITE"
      },
      {
        "resource": "namespaces/mybazaar-c4881/services/loginwithpin",
        "permission": "run.services.update",
        "granted": true,
        "resourceAttributes": {
          "service": "run.googleapis.com/",
          "name": "namespaces/mybazaar-c4881/services/loginwithpin",
          "type": "run.googleapis.com/Service"
        },
        "permissionType": "ADMIN_WRITE"
      }
    ],
    "resourceName": "namespaces/mybazaar-c4881/services/loginwithpin",
    "resourceLocation": {
      "currentLocations": [
        "us-central1"
      ]
    }
  },
  "insertId": "-6d3rvzdv4fy",
  "resource": {
    "type": "cloud_run_revision",
    "labels": {
      "revision_name": "",
      "service_name": "loginwithpin",
      "project_id": "mybazaar-c4881",
      "configuration_name": "",
      "location": "us-central1"
    }
  },
  "timestamp": "2025-10-15T02:20:35.444251Z",
  "severity": "NOTICE",
  "logName": "projects/mybazaar-c4881/logs/cloudaudit.googleapis.com%2Factivity",
  "receiveTimestamp": "2025-10-15T02:20:35.859374872Z"
}
```

#
```
2025-10-15T01:48:46.433827Z ? loginwithpin: [cr6x] ❌ Error checking auth user: FirebaseAuthError: There is no configuration corresponding to the provided identifier.
    at FirebaseAuthError.fromServerError (/workspace/node_modules/firebase-admin/lib/utils/error.js:148:16)
    at /workspace/node_modules/firebase-admin/lib/auth/auth-api-request.js:1629:49
    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)
    at async /workspace/index.js:207:22 {
  errorInfo: {
    code: 'auth/configuration-not-found',
    message: 'There is no configuration corresponding to the provided identifier.'
  },
  codePrefix: 'auth'
}

2025-10-15T01:48:46.434330Z ? loginwithpin: [cr6x] ❌ ERROR after 2684ms: {
  name: 'Error',
  message: 'There is no configuration corresponding to the provided identifier.',
  code: 'auth/configuration-not-found',
  stack: 'Error: There is no configuration corresponding to the provided identifier.\n' +
    '    at FirebaseAuthError.fromServerError (/workspace/node_modules/firebase-admin/lib/utils/error.js:148:16)\n' +
    '    at /workspace/node_modules/firebase-admin/lib/auth/auth-api-request.js:1629:49\n' +
    '    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)\n' +
    '    at async /workspace/index.js:207:22'
}

2025-10-15T02:20:36.148900960Z N loginWithPin: {"@type":"type.googleapis.com/google.cloud.audit.AuditLog","authenticationInfo":{"principalEmail":"weschen@mybazaar.my","principalSubject":"user:weschen@mybazaar.my","oauthInfo":{"oauthClientId":"563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com"}},"requestMetadata":{"callerIp":"115.135.205.111","callerSuppliedUserAgent":"FirebaseCLI/14.19.1,gzip(gfe),gzip(gfe)","requestAttributes":{"time":"2025-10-15T02:20:35.169107520Z","auth":{}},"destinationAttributes":{}},"serviceName":"cloudfunctions.googleapis.com","methodName":"google.cloud.functions.v2.FunctionService.UpdateFunction","authorizationInfo":[{"resource":"projects/mybazaar-c4881/locations/us-central1/functions/loginWithPin","permission":"cloudfunctions.functions.update","granted":true,"resourceAttributes":{"service":"cloudfunctions.googleapis.com","name":"projects/mybazaar-c4881/locations/us-central1/functions/loginWithPin","type":"cloudfunctions.googleapis.com/Function"},"permissionType":"ADMIN_WRITE"}],"resourceName":"projects/mybazaar-c4881/locations/us-central1/functions/loginWithPin","request":{"@type":"type.googleapis.com/google.cloud.functions.v2.UpdateFunctionRequest","update_mask":{"paths":["name","build_config.runtime","build_config.entry_point","build_config.source.storage_source.bucket","build_config.source.storage_source.object","build_config.environment_variables","build_config.source_token","service_config.environment_variables","service_config.ingress_settings","service_config.timeout_seconds","service_config.service_account_email","service_config.available_memory","service_config.min_instance_count","service_config.max_instance_count","service_config.max_instance_request_concurrency","service_config.available_cpu","service_config.vpc_connector","service_config.vpc_connector_egress_settings","labels"]},"function":{"labels":{"deployment-tool":"cli-firebase","firebase-functions-hash":"4a978b93106eb02f408cc4d2ae68e0cac8f97d6d"},"service_config":{"available_cpu":"1","available_memory":"256Mi","max_instance_request_concurrency":80},"build_config":{"entry_point":"loginWithPin","source":{},"runtime":"nodejs22"},"name":"projects/mybazaar-c4881/locations/us-central1/functions/loginWithPin"}},"response":{"@type":"type.googleapis.com/google.longrunning.Operation"},"resourceLocation":{"currentLocations":["us-central1"]}}
2025-10-15T02:21:29.696558Z I loginwithpin: Starting new instance. Reason: DEPLOYMENT_ROLLOUT - Instance started due to traffic shifting between revisions due to deployment, traffic split adjustment, or deployment health check.
2025-10-15T02:21:31.629657Z I loginwithpin: Default STARTUP TCP probe succeeded after 1 attempt for container "worker" on port 8080.
2025-10-15T02:21:33.449294324Z N loginWithPin: {"@type":"type.googleapis.com/google.cloud.audit.AuditLog","status":{},"authenticationInfo":{"principalEmail":"weschen@mybazaar.my","principalSubject":"user:weschen@mybazaar.my","oauthInfo":{"oauthClientId":"563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com"}},"requestMetadata":{"requestAttributes":{},"destinationAttributes":{}},"serviceName":"cloudfunctions.googleapis.com","methodName":"google.cloud.functions.v2.FunctionService.UpdateFunction","resourceName":"projects/mybazaar-c4881/locations/us-central1/functions/loginWithPin","response":{"name":"projects/mybazaar-c4881/locations/us-central1/functions/loginWithPin","serviceConfig":{"revision":"loginwithpin-00006-hiz","allTrafficOnLatestRevision":true,"availableMemory":"256Mi","uri":"https://loginwithpin-zgmq4nw2bq-uc.a.run.app","serviceAccountEmail":"1069326034581-compute@developer.gserviceaccount.com","maxInstanceCount":20,"ingressSettings":"ALLOW_ALL","availableCpu":"1","maxInstanceRequestConcurrency":80,"timeoutSeconds":60},"environment":"GEN_2","updateTime":"2025-10-15T02:20:36.132891554Z","state":"ACTIVE","buildConfig":{"dockerRepository":"projects/mybazaar-c4881/locations/us-central1/repositories/gcf-artifacts","source":{},"serviceAccount":"projects/mybazaar-c4881/serviceAccounts/1069326034581-compute@developer.gserviceaccount.com","entryPoint":"loginWithPin","runtime":"nodejs22","dockerRegistry":"ARTIFACT_REGISTRY","automaticUpdatePolicy":{}},"createTime":"2025-10-14T11:15:55.756169123Z","labels":{"deployment-tool":"cli-firebase","firebase-functions-hash":"4a978b93106eb02f408cc4d2ae68e0cac8f97d6d"},"url":"https://us-central1-mybazaar-c4881.cloudfunctions.net/loginWithPin","@type":"type.googleapis.com/google.cloud.functions.v2.Function","satisfiesPzi":true},"resourceLocation":{"currentLocations":["us-central1"]}}
2025-10-15T02:25:56.666011Z I loginwithpin:
2025-10-15T02:25:56.943333Z E loginwithpin:
2025-10-15T02:25:56.974265Z ? loginwithpin: [5msz8k] ===== LOGIN REQUEST START =====

2025-10-15T02:25:56.974444Z ? loginwithpin: [5msz8k] Method: POST

2025-10-15T02:25:56.974797Z ? loginwithpin: [5msz8k] Headers: {"host":"us-central1-mybazaar-c4881.cloudfunctions.net","content-length":"118","sec-ch-ua-platform":"\"Windows\"","user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36","sec-ch-ua":"\"Google Chrome\";v=\"141\", \"Not?A_Brand\";v=\"8\", \"Chromium\";v=\"141\"","content-type":"application/json","sec-ch-ua-mobile":"?0","accept":"*/*","origin":"http://localhost:5173","sec-fetch-site":"cross-site","sec-fetch-mode":"cors","sec-fetch-dest":"empty","referer":"http://localhost:5173/","accept-language":"en-US,en;q=0.9,zh-TW;q=0.8,zh;q=0.7","priority":"u=1, i","x-cloud-trace-context":"1cfb32c24a18378f0c7834bb46ae5ba3/9696527082194737745","x-forwarded-proto":"https","traceparent":"00-1cfb32c24a18378f0c7834bb46ae5ba3-8690fc01c12c1a51-00","x-forwarded-for":"115.135.205.111","forwarded":"for=\"115.135.205.111\";proto=https","accept-encoding":"gzip, deflate, br, zstd"}

2025-10-15T02:25:56.974932Z ? loginwithpin: [5msz8k] Body: {"phoneNumber":"0123456789","pin":"Test1234","organizationId":"fVqHtUWjh58HVJu5cMAn","eventId":"zcaWnsF3zTNeqZ738x2V"}

2025-10-15T02:25:56.975408Z ? loginwithpin: [5msz8k] 📥 Received data: {
  phoneNumber: '012***',
  hasPin: true,
  pinLength: 8,
  organizationId: 'fVqHtUWjh58HVJu5cMAn',
  eventId: 'zcaWnsF3zTNeqZ738x2V'
}

2025-10-15T02:25:56.975676Z ? loginwithpin: [5msz8k] 📱 Normalized phone: 123456789

2025-10-15T02:25:56.975804Z ? loginwithpin: [5msz8k] 📂 Collection path: organizations/fVqHtUWjh58HVJu5cMAn/events/zcaWnsF3zTNeqZ738x2V/users
```