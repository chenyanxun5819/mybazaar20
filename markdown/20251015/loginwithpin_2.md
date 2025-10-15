# 
```
{
  "protoPayload": {
    "@type": "type.googleapis.com/google.cloud.audit.AuditLog",
    "status": {},
    "authenticationInfo": {
      "principalEmail": "weschen@mybazaar.my",
      "principalSubject": "user:weschen@mybazaar.my",
      "oauthInfo": {
        "oauthClientId": "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com"
      }
    },
    "requestMetadata": {
      "requestAttributes": {},
      "destinationAttributes": {}
    },
    "serviceName": "cloudfunctions.googleapis.com",
    "methodName": "google.cloud.functions.v2.FunctionService.UpdateFunction",
    "resourceName": "projects/mybazaar-c4881/locations/us-central1/functions/loginWithPin",
    "response": {
      "name": "projects/mybazaar-c4881/locations/us-central1/functions/loginWithPin",
      "serviceConfig": {
        "revision": "loginwithpin-00006-hiz",
        "allTrafficOnLatestRevision": true,
        "availableMemory": "256Mi",
        "uri": "https://loginwithpin-zgmq4nw2bq-uc.a.run.app",
        "serviceAccountEmail": "1069326034581-compute@developer.gserviceaccount.com",
        "maxInstanceCount": 20,
        "ingressSettings": "ALLOW_ALL",
        "availableCpu": "1",
        "maxInstanceRequestConcurrency": 80,
        "timeoutSeconds": 60
      },
      "environment": "GEN_2",
      "updateTime": "2025-10-15T02:20:36.132891554Z",
      "state": "ACTIVE",
      "buildConfig": {
        "dockerRepository": "projects/mybazaar-c4881/locations/us-central1/repositories/gcf-artifacts",
        "source": {},
        "serviceAccount": "projects/mybazaar-c4881/serviceAccounts/1069326034581-compute@developer.gserviceaccount.com",
        "entryPoint": "loginWithPin",
        "runtime": "nodejs22",
        "dockerRegistry": "ARTIFACT_REGISTRY",
        "automaticUpdatePolicy": {}
      },
      "createTime": "2025-10-14T11:15:55.756169123Z",
      "labels": {
        "deployment-tool": "cli-firebase",
        "firebase-functions-hash": "4a978b93106eb02f408cc4d2ae68e0cac8f97d6d"
      },
      "url": "https://us-central1-mybazaar-c4881.cloudfunctions.net/loginWithPin",
      "@type": "type.googleapis.com/google.cloud.functions.v2.Function",
      "satisfiesPzi": true
    },
    "resourceLocation": {
      "currentLocations": [
        "us-central1"
      ]
    }
  },
  "insertId": "8mcj5xd2pm2",
  "resource": {
    "type": "cloud_function",
    "labels": {
      "function_name": "loginWithPin",
      "region": "us-central1",
      "project_id": "mybazaar-c4881"
    }
  },
  "timestamp": "2025-10-15T02:21:33.449294324Z",
  "severity": "NOTICE",
  "logName": "projects/mybazaar-c4881/logs/cloudaudit.googleapis.com%2Factivity",
  "operation": {
    "id": "projects/mybazaar-c4881/locations/us-central1/operations/operation-1760494835169-64129254779ba-24623960-4cc6a390",
    "producer": "cloudfunctions.googleapis.com",
    "last": true
  },
  "receiveTimestamp": "2025-10-15T02:21:33.972348968Z"
}
```

#
```
{
  "protoPayload": {
    "@type": "type.googleapis.com/google.cloud.audit.AuditLog",
    "authenticationInfo": {
      "principalEmail": "weschen@mybazaar.my",
      "principalSubject": "user:weschen@mybazaar.my",
      "oauthInfo": {
        "oauthClientId": "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com"
      }
    },
    "requestMetadata": {
      "callerIp": "115.135.205.111",
      "callerSuppliedUserAgent": "FirebaseCLI/14.19.1,gzip(gfe),gzip(gfe)",
      "requestAttributes": {
        "time": "2025-10-15T02:20:35.169107520Z",
        "auth": {}
      },
      "destinationAttributes": {}
    },
    "serviceName": "cloudfunctions.googleapis.com",
    "methodName": "google.cloud.functions.v2.FunctionService.UpdateFunction",
    "authorizationInfo": [
      {
        "resource": "projects/mybazaar-c4881/locations/us-central1/functions/loginWithPin",
        "permission": "cloudfunctions.functions.update",
        "granted": true,
        "resourceAttributes": {
          "service": "cloudfunctions.googleapis.com",
          "name": "projects/mybazaar-c4881/locations/us-central1/functions/loginWithPin",
          "type": "cloudfunctions.googleapis.com/Function"
        },
        "permissionType": "ADMIN_WRITE"
      }
    ],
    "resourceName": "projects/mybazaar-c4881/locations/us-central1/functions/loginWithPin",
    "request": {
      "@type": "type.googleapis.com/google.cloud.functions.v2.UpdateFunctionRequest",
      "update_mask": {
        "paths": [
          "name",
          "build_config.runtime",
          "build_config.entry_point",
          "build_config.source.storage_source.bucket",
          "build_config.source.storage_source.object",
          "build_config.environment_variables",
          "build_config.source_token",
          "service_config.environment_variables",
          "service_config.ingress_settings",
          "service_config.timeout_seconds",
          "service_config.service_account_email",
          "service_config.available_memory",
          "service_config.min_instance_count",
          "service_config.max_instance_count",
          "service_config.max_instance_request_concurrency",
          "service_config.available_cpu",
          "service_config.vpc_connector",
          "service_config.vpc_connector_egress_settings",
          "labels"
        ]
      },
      "function": {
        "labels": {
          "deployment-tool": "cli-firebase",
          "firebase-functions-hash": "4a978b93106eb02f408cc4d2ae68e0cac8f97d6d"
        },
        "service_config": {
          "available_cpu": "1",
          "available_memory": "256Mi",
          "max_instance_request_concurrency": 80
        },
        "build_config": {
          "entry_point": "loginWithPin",
          "source": {},
          "runtime": "nodejs22"
        },
        "name": "projects/mybazaar-c4881/locations/us-central1/functions/loginWithPin"
      }
    },
    "response": {
      "@type": "type.googleapis.com/google.longrunning.Operation"
    },
    "resourceLocation": {
      "currentLocations": [
        "us-central1"
      ]
    }
  },
  "insertId": "8mcj5xd2plr",
  "resource": {
    "type": "cloud_function",
    "labels": {
      "region": "us-central1",
      "project_id": "mybazaar-c4881",
      "function_name": "loginWithPin"
    }
  },
  "timestamp": "2025-10-15T02:20:36.148900960Z",
  "severity": "NOTICE",
  "logName": "projects/mybazaar-c4881/logs/cloudaudit.googleapis.com%2Factivity",
  "operation": {
    "id": "projects/mybazaar-c4881/locations/us-central1/operations/operation-1760494835169-64129254779ba-24623960-4cc6a390",
    "producer": "cloudfunctions.googleapis.com",
    "first": true
  },
  "receiveTimestamp": "2025-10-15T02:20:36.913358407Z"
}
```